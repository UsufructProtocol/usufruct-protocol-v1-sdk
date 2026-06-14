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

/** `0x`-insensitive id equality (effects ids vs branded escrow id). */
function sameId(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(/^0x/, '').toLowerCase().replace(/^0+/, '');
  return norm(a) === norm(b);
}

/**
 * The post-tx version of `escrowId` if this checkpoint changed it, else
 * undefined. Defensive: the stream's `readMask` selects a minimal shape, but
 * we optional-chain through it so a wider/narrower mask still works.
 */
function changedVersion(checkpoint: unknown, escrowId: string): string | undefined {
  const txs = (checkpoint as { transactions?: unknown[] })?.transactions ?? [];
  for (const tx of txs) {
    const changed =
      (tx as { effects?: { changedObjects?: unknown[] } })?.effects?.changedObjects ?? [];
    for (const obj of changed) {
      const o = obj as { objectId?: string; outputVersion?: bigint | string };
      if (o.objectId != null && sameId(o.objectId, escrowId)) {
        return o.outputVersion != null ? String(o.outputVersion) : '';
      }
    }
  }
  return undefined;
}

/** Reconnect backoff schedule (ms): the stream is resumable without gaps. */
const RECONNECT_BACKOFF_MS = [500, 1000, 2000, 5000] as const;

/**
 * Live-chain `Source` over gRPC whose `subscribe` is server-push. `fetch`,
 * `query`, and decode are delegated to an internal `chainSource` over the same
 * client — only `subscribe` differs.
 */
export function grpcSource<
  A extends AssetSchema = typeof uidAssetSchema,
  C extends string = string,
>(client: SuiGrpcClient, opts?: ChainSourceOpts<A>): Source<A, C> {
  const core = client as unknown as ClientWithCoreApi;
  const base = chainSource<A, C>(core, opts);

  // Like `chainSource.fetch`, but keeps the object version — `subscribe`
  // dedupes on it (the decoded `EscrowState` carries no version).
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

  // FieldMask over the response — we only need each changed object's id and
  // post-tx version. (Paths are the chain's say; confirmed live before pinning.)
  const readMask = {
    paths: [
      'checkpoint.transactions.effects.changed_objects.object_id',
      'checkpoint.transactions.effects.changed_objects.output_version',
    ],
  };

  return {
    fetch: base.fetch,
    query: base.query,

    subscribe: async function* (escrowId: Id<'Escrow'>, subOpts?: SubscribeOpts) {
      const signal = subOpts?.signal;

      // Initial state once (parity with the poll source), then push deltas.
      const first = await fetchVersioned(escrowId);
      let lastVersion = first.version;
      yield first.state;

      let attempt = 0;
      while (!signal?.aborted) {
        const call = client.subscriptionService.subscribeCheckpoints(
          { readMask },
          signal ? { abort: signal } : {},
        );
        try {
          for await (const res of call.responses) {
            if (signal?.aborted) break;
            const version = changedVersion(res.checkpoint, escrowId);
            if (version === undefined) continue; // checkpoint didn't touch us
            if (version === lastVersion) continue; // dedupe by post-tx version
            // Effects carry id+version, not contents — re-fetch to decode.
            const next = await fetchVersioned(escrowId);
            if (next.version === lastVersion) continue;
            lastVersion = next.version;
            yield next.state;
          }
          attempt = 0; // a clean completion: re-open from the latest checkpoint
        } catch {
          if (signal?.aborted) break; // abort surfaces as a stream error — expected
          // The stream is resumable without gaps; back off and re-open. The
          // version dedupe above absorbs any checkpoint replayed on reconnect.
          const wait = RECONNECT_BACKOFF_MS[Math.min(attempt, RECONNECT_BACKOFF_MS.length - 1)]!;
          attempt += 1;
          await sleep(wait, signal);
        }
      }
    },
  };
}
