/**
 * ❹ Source (SPEC §4.4) — the single point of IO. It yields the RAW
 * `EscrowSnapshot` (ids + type tag + BCS bytes); decoding into an `EscrowState`
 * is a mirror step (`@usufruct-protocol/sim`), so the core's IO boundary never
 * depends on the decoded model. Nothing downstream knows which transport
 * produced a snapshot.
 *
 * Three IO shapes: `fetch` (the snapshot now), `subscribe` (snapshots as the
 * object changes), `query` (which escrows exist for a caller). `subscribe` is a
 * standard `AsyncIterable` rather than SPEC's Observable sketch, to avoid a
 * reactive-library dependency.
 */
import type { ClientWithCoreApi } from '@mysten/sui/client';
import { UsufructCap } from '../codegen/usufruct/usufruct_cap.js';
import type { Id } from './brand.js';
import type { EscrowSnapshot } from './state.js';

/**
 * Discovery predicate for `query`. Escrows are *shared* objects, so they
 * cannot be listed by owner; the reachable handle over the core API is the
 * caller's owned `UsufructCap` (`byUsufructuary` — "the escrows this address
 * rents"). The other variants need an indexer (`indexerSource`, GraphQL):
 * `byGovernor` (who integrated), `byAssetType` (escrows of a Move type),
 * `all` (every escrow of the package). SPEC §6.3.
 */
export type Predicate =
  | { readonly byUsufructuary: string }
  | { readonly byGovernor: string }
  | { readonly byAssetType: string }
  | { readonly all: true };

export interface SubscribeOpts {
  /** Poll cadence in ms (default 1000). */
  readonly pollIntervalMs?: number;
  /** Stop the iteration when aborted (clean return, no throw). */
  readonly signal?: AbortSignal;
}

/**
 * A `Source` yields the RAW `EscrowSnapshot` (ids + type tag + BCS bytes);
 * decoding to a typed `EscrowState` is the mirror's step (`decodeEscrowState`).
 * No `A`/`C` type params — the snapshot is not parameterized by the asset/coin.
 */
export interface Source {
  readonly fetch: (id: Id<'Escrow'>) => Promise<EscrowSnapshot>;
  readonly subscribe: (
    id: Id<'Escrow'>,
    opts?: SubscribeOpts,
  ) => AsyncIterable<EscrowSnapshot>;
  readonly query: (predicate: Predicate) => AsyncIterable<EscrowSnapshot>;
}

export interface ChainSourceOpts {
  /** Deployed package id — required by `query` to build the cap type filter. */
  readonly packageId?: string;
}

/** Whether an error indicates the object does not exist (deleted / wrong id). */
export function isMissingObject(e: unknown): boolean {
  const msg = String((e as { message?: unknown })?.message ?? e).toLowerCase();
  return msg.includes('notexist') || msg.includes('not exist') || msg.includes('not found');
}

/** Abortable sleep; resolves early (not rejects) when the signal fires. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Single-consumer push channel: an `AsyncIterable<T>` fed by `push`, ended by
 * `close`. Backpressure is the consumer's pull — values buffer between pulls.
 * Shared by the push sources (`grpcSource`, `memorySource`).
 */
export function channel<T>(): { push: (v: T) => void; close: () => void } & AsyncIterable<T> {
  const buffer: T[] = [];
  let waiting: ((r: IteratorResult<T>) => void) | null = null;
  let done = false;
  return {
    push(v) {
      if (done) return;
      if (waiting) {
        const w = waiting;
        waiting = null;
        w({ value: v, done: false });
      } else {
        buffer.push(v);
      }
    },
    close() {
      if (done) return;
      done = true;
      if (waiting) {
        const w = waiting;
        waiting = null;
        w({ value: undefined as never, done: true });
      }
    },
    async *[Symbol.asyncIterator]() {
      for (;;) {
        if (buffer.length > 0) {
          yield buffer.shift()!;
          continue;
        }
        if (done) return;
        const r = await new Promise<IteratorResult<T>>((resolve) => {
          waiting = resolve;
        });
        if (r.done) return;
        yield r.value;
      }
    },
  };
}

/**
 * Live-chain `Source` over any `ClientWithCoreApi` transport (gRPC or
 * JSON-RPC). `subscribe` polls and dedupes by object version (the core API
 * has no push stream — that is gRPC-only, a convenience layer). `query`
 * walks the caller's owned `UsufructCap`s to the escrows they reference.
 */
export function chainSource(client: ClientWithCoreApi, opts?: ChainSourceOpts): Source {
  const snap = (object: { objectId: string; type: string; content: Uint8Array }): EscrowSnapshot => ({
    objectId: object.objectId,
    type: object.type,
    content: object.content,
  });

  const fetch = async (escrowId: Id<'Escrow'>): Promise<EscrowSnapshot> => {
    const { object } = await client.core.getObject({
      objectId: escrowId,
      include: { content: true },
    });
    return snap(object);
  };

  return {
    fetch,

    subscribe: async function* (escrowId, subOpts) {
      const interval = subOpts?.pollIntervalMs ?? 1000;
      const signal = subOpts?.signal;
      let lastVersion: string | undefined;
      while (!signal?.aborted) {
        const { object } = await client.core.getObject({
          objectId: escrowId,
          include: { content: true },
        });
        if (object.version !== lastVersion) {
          lastVersion = object.version;
          yield snap(object);
        }
        if (signal?.aborted) break;
        await sleep(interval, signal);
      }
    },

    query: async function* (predicate) {
      if (!('byUsufructuary' in predicate)) {
        throw new Error(
          'chainSource.query supports only { byUsufructuary } (escrows are shared); ' +
            'use indexerSource for byGovernor / byAssetType / all (GraphQL, SPEC §6.3)',
        );
      }
      if (opts?.packageId == null) {
        throw new Error('chainSource.query requires opts.packageId (UsufructCap type filter)');
      }
      const capType = `${opts.packageId}::usufruct_cap::UsufructCap`;
      const seen = new Set<string>();
      let cursor: string | null = null;
      do {
        const page: Awaited<ReturnType<typeof client.core.listOwnedObjects<{ content: true }>>> =
          await client.core.listOwnedObjects({
            owner: predicate.byUsufructuary,
            type: capType,
            cursor,
            limit: 50,
            include: { content: true },
          });
        for (const cap of page.objects) {
          const escrowId = UsufructCap.parse(cap.content).escrow_identity.id;
          if (seen.has(escrowId)) continue;
          seen.add(escrowId);
          // A cap outlives its escrow (it is burned separately), so a cap can
          // point at an escrow that was already claimed/retired and deleted.
          // Discovery yields current escrows; skip targets that no longer
          // exist. (Other failures still surface — only a missing object is
          // swallowed.)
          let state: EscrowSnapshot;
          try {
            state = await fetch(escrowId as Id<'Escrow'>);
          } catch (e) {
            if (isMissingObject(e)) continue;
            throw e;
          }
          yield state;
        }
        cursor = page.hasNextPage ? page.cursor : null;
      } while (cursor);
    },
  };
}
