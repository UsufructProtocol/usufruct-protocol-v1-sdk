/**
 * ❹ Source (SPEC §4.4) — the single point of IO. Everything below it
 * (`View`, `Action.step`) is pure; nothing downstream knows which transport
 * produced a given `EscrowState`.
 *
 * Three IO shapes: `fetch` (the state now), `subscribe` (the state as it
 * changes), `query` (which states exist for a caller). `subscribe` is the
 * standard `AsyncIterable` rather than SPEC's Observable sketch, to avoid a
 * reactive-library dependency.
 */
import type { ClientWithCoreApi } from '@mysten/sui/client';
import { UsufructCap } from '../codegen/usufruct/usufruct_cap.js';
import type { Id } from './brand.js';
import type { AssetSchema, EscrowState, uidAssetSchema } from './state.js';
import { decodeEscrowState } from './state.js';

/**
 * Discovery predicate for `query`. Escrows are *shared* objects, so they
 * cannot be listed by owner; the reachable handle is the caller's owned
 * `UsufructCap`, which carries its escrow id. Hence "the escrows this
 * address rents". (Discovery by governor / asset type / history needs an
 * indexer — out of the kernel; see SPEC §6.3.)
 */
export interface Predicate {
  readonly byUsufructuary: string;
}

export interface SubscribeOpts {
  /** Poll cadence in ms (default 1000). */
  readonly pollIntervalMs?: number;
  /** Stop the iteration when aborted (clean return, no throw). */
  readonly signal?: AbortSignal;
}

export interface Source<
  A extends AssetSchema = typeof uidAssetSchema,
  C extends string = string,
> {
  readonly fetch: (id: Id<'Escrow'>) => Promise<EscrowState<A, C>>;
  readonly subscribe: (
    id: Id<'Escrow'>,
    opts?: SubscribeOpts,
  ) => AsyncIterable<EscrowState<A, C>>;
  readonly query: (predicate: Predicate) => AsyncIterable<EscrowState<A, C>>;
}

export interface ChainSourceOpts<A extends AssetSchema> {
  /** Asset BCS schema (defaults to uid-only, SPEC §10). */
  readonly assetSchema?: A;
  /** Deployed package id — required by `query` to build the cap type filter. */
  readonly packageId?: string;
}

/** Abortable sleep; resolves early (not rejects) when the signal fires. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
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
 * Live-chain `Source` over any `ClientWithCoreApi` transport (gRPC or
 * JSON-RPC). `subscribe` polls and dedupes by object version (the core API
 * has no push stream — that is gRPC-only, a convenience layer). `query`
 * walks the caller's owned `UsufructCap`s to the escrows they reference.
 */
export function chainSource<
  A extends AssetSchema = typeof uidAssetSchema,
  C extends string = string,
>(client: ClientWithCoreApi, opts?: ChainSourceOpts<A>): Source<A, C> {
  const decode = (object: { objectId: string; type: string; content: Uint8Array }) =>
    decodeEscrowState<A, C>(
      { objectId: object.objectId, type: object.type, content: object.content },
      opts?.assetSchema,
    );

  const fetch = async (escrowId: Id<'Escrow'>): Promise<EscrowState<A, C>> => {
    const { object } = await client.core.getObject({
      objectId: escrowId,
      include: { content: true },
    });
    return decode(object);
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
          yield decode(object);
        }
        if (signal?.aborted) break;
        await sleep(interval, signal);
      }
    },

    query: async function* (predicate) {
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
          yield await fetch(escrowId as Id<'Escrow'>);
        }
        cursor = page.hasNextPage ? page.cursor : null;
      } while (cursor);
    },
  };
}
