/**
 * gRPC push `Source` (SPEC §4.4) — `subscribe` as server-push instead of
 * polling. The fullnode's `SubscriptionService.subscribeCheckpoints` streams
 * every executed checkpoint (a firehose: no per-object/-event filter); we scan
 * each checkpoint's transaction effects for the target escrow and, on a real
 * change, re-`fetch` + decode the new state. Latency ≈ a checkpoint instead of
 * a poll interval, and zero network traffic while the escrow is idle.
 *
 * `fetch`/`query` are unchanged from `chainSource` (the core API serves them);
 * only `subscribe` is replaced. So `grpcSource` is `Source`-conformant and
 * drop-in wherever a `Source` is expected — downstream can't tell push from
 * poll. Push is gRPC-only (`subscriptionService` is absent from the core API
 * and JSON-RPC), which is why it is a transport-specific layer over the
 * transport-agnostic kernel rather than part of it.
 *
 * The effects give the changed object's id and post-tx version but *not* its
 * decodable contents ("Type information is not provided by the effects
 * structure"), so decoding stays in one place — a single `getObject` per real
 * change, never per checkpoint.
 *
 * Because every stream is the *same* firehose, `subscribeMany` opens it once
 * and demultiplexes by id — N escrows watched over one subscription instead of
 * N identical streams.
 */
import type { SuiGrpcClient } from '@mysten/sui/grpc';
import type { ClientWithCoreApi } from '@mysten/sui/client';
import type { Id } from './brand.js';
import { decodeEscrowState } from './state.js';
import type { AssetSchema, EscrowState, uidAssetSchema } from './state.js';
import {
  chainSource,
  sleep,
  type ChainSourceOpts,
  type Source,
  type SubscribeOpts,
} from './source.js';

/** Canonical form of an object id (effects ids vs branded escrow ids). */
function normId(s: string): string {
  return s.replace(/^0x/, '').toLowerCase().replace(/^0+/, '');
}

/** A tagged push emission — which escrow changed, and its new state. */
export interface EscrowUpdate<
  A extends AssetSchema = typeof uidAssetSchema,
  C extends string = string,
> {
  readonly escrowId: Id<'Escrow'>;
  readonly state: EscrowState<A, C>;
}

/** `grpcSource` is a `Source` plus the gRPC-only multiplexed `subscribeMany`. */
export type GrpcSource<
  A extends AssetSchema = typeof uidAssetSchema,
  C extends string = string,
> = Source<A, C> & {
  readonly subscribeMany: (
    escrowIds: readonly Id<'Escrow'>[],
    opts?: SubscribeOpts,
  ) => AsyncIterable<EscrowUpdate<A, C>>;
};

/**
 * Every changed object in a checkpoint as `{ objectId, version }` (post-tx
 * version). Defensive: the stream's `readMask` selects a minimal shape, but we
 * optional-chain through it so a wider/narrower mask still works.
 */
function* scanChanged(checkpoint: unknown): Generator<{ objectId: string; version: string }> {
  const txs = (checkpoint as { transactions?: unknown[] })?.transactions ?? [];
  for (const tx of txs) {
    const changed =
      (tx as { effects?: { changedObjects?: unknown[] } })?.effects?.changedObjects ?? [];
    for (const obj of changed) {
      const o = obj as { objectId?: string; outputVersion?: bigint | string };
      if (o.objectId != null) {
        yield { objectId: o.objectId, version: o.outputVersion != null ? String(o.outputVersion) : '' };
      }
    }
  }
}

/** Reconnect backoff schedule (ms): the stream is resumable without gaps. */
const RECONNECT_BACKOFF_MS = [500, 1000, 2000, 5000] as const;

/**
 * Live-chain `Source` over gRPC whose `subscribe` is server-push, plus
 * `subscribeMany` for watching many escrows over one stream. `fetch`, `query`,
 * and decode are delegated to an internal `chainSource` over the same client.
 */
export function grpcSource<
  A extends AssetSchema = typeof uidAssetSchema,
  C extends string = string,
>(client: SuiGrpcClient, opts?: ChainSourceOpts<A>): GrpcSource<A, C> {
  const core = client as unknown as ClientWithCoreApi;
  const base = chainSource<A, C>(core, opts);

  // Like `chainSource.fetch`, but keeps the object version — subscriptions
  // dedupe on it (the decoded `EscrowState` carries no version).
  const fetchVersioned = async (
    escrowId: Id<'Escrow'>,
  ): Promise<{ state: EscrowState<A, C>; version: string }> => {
    const { object } = await core.core.getObject({
      objectId: escrowId,
      include: { content: true },
    });
    const state = decodeEscrowState<A, C>(
      { objectId: object.objectId, type: object.type, content: object.content },
      opts?.assetSchema,
    );
    return { state, version: object.version };
  };

  // FieldMask — paths are rooted at the Checkpoint message (confirmed live:
  // a response-rooted "checkpoint.*" prefix yields empty transactions, and
  // *no* mask yields only the bare checkpoint summary). We request just each
  // changed object's id and post-tx version.
  const readMask = {
    paths: [
      'transactions.effects.changed_objects.object_id',
      'transactions.effects.changed_objects.output_version',
    ],
  };

  // The shared firehose: yields each checkpoint, re-opening with bounded
  // backoff if the stream drops (resumable without gaps — the per-id version
  // dedupe downstream absorbs any checkpoint replayed on reconnect). Stops
  // cleanly on abort.
  async function* firehose(signal?: AbortSignal): AsyncGenerator<unknown> {
    let attempt = 0;
    while (!signal?.aborted) {
      const call = client.subscriptionService.subscribeCheckpoints(
        { readMask },
        signal ? { abort: signal } : {},
      );
      try {
        for await (const res of call.responses) {
          if (signal?.aborted) return;
          yield res.checkpoint;
        }
        attempt = 0; // a clean completion: re-open from the latest checkpoint
      } catch {
        if (signal?.aborted) return; // abort surfaces as a stream error — expected
        const wait = RECONNECT_BACKOFF_MS[Math.min(attempt, RECONNECT_BACKOFF_MS.length - 1)]!;
        attempt += 1;
        await sleep(wait, signal);
      }
    }
  }

  return {
    fetch: base.fetch,
    query: base.query,

    subscribe: async function* (escrowId: Id<'Escrow'>, subOpts?: SubscribeOpts) {
      const signal = subOpts?.signal;
      const target = normId(escrowId);

      // Initial state once (parity with the poll source), then push deltas.
      const first = await fetchVersioned(escrowId);
      let lastVersion = first.version;
      yield first.state;

      for await (const checkpoint of firehose(signal)) {
        if (signal?.aborted) break;
        let touched = false;
        for (const { objectId, version } of scanChanged(checkpoint)) {
          if (normId(objectId) === target && version !== lastVersion) touched = true;
        }
        if (!touched) continue; // checkpoint didn't change us (new version)
        // Effects carry id+version, not contents — re-fetch to decode.
        const next = await fetchVersioned(escrowId);
        if (next.version === lastVersion) continue;
        lastVersion = next.version;
        yield next.state;
      }
    },

    subscribeMany: async function* (escrowIds, subOpts) {
      const signal = subOpts?.signal;
      const seen = new Map<string, string>(); // normId → last post-tx version
      const idByNorm = new Map<string, Id<'Escrow'>>();
      for (const escrowId of escrowIds) idByNorm.set(normId(escrowId), escrowId);

      // Initial state for each escrow (in parallel), then push deltas.
      const initial = await Promise.all(
        escrowIds.map(async (escrowId) => ({ escrowId, ...(await fetchVersioned(escrowId)) })),
      );
      for (const { escrowId, state, version } of initial) {
        seen.set(normId(escrowId), version);
        yield { escrowId, state };
      }

      for await (const checkpoint of firehose(signal)) {
        if (signal?.aborted) break;
        // Collect the distinct escrows this checkpoint changed to a new version.
        const hits = new Set<string>();
        for (const { objectId, version } of scanChanged(checkpoint)) {
          const n = normId(objectId);
          if (seen.has(n) && version !== seen.get(n)) hits.add(n);
        }
        for (const n of hits) {
          const escrowId = idByNorm.get(n)!;
          const next = await fetchVersioned(escrowId);
          if (next.version === seen.get(n)) continue;
          seen.set(n, next.version);
          yield { escrowId, state: next.state };
        }
      }
    },
  };
}
