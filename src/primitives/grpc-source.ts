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
  eventKey,
  normEscrowId,
  typedEventFromBytes,
  type TypedEvent,
} from '../indexer/events.js';
import {
  chainSource,
  channel,
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

/**
 * A live multiplexed subscription: iterate it for `{ escrowId, state }` updates,
 * and grow/shrink the watched set in flight without reopening the firehose.
 * `add` emits the new escrow's initial state; `remove` stops watching (no
 * emission); `close` ends the iteration cleanly. `opts.signal` also closes it.
 */
export interface ManySubscription<
  A extends AssetSchema = typeof uidAssetSchema,
  C extends string = string,
> extends AsyncIterable<EscrowUpdate<A, C>> {
  add(escrowId: Id<'Escrow'>): Promise<void>;
  remove(escrowId: Id<'Escrow'>): void;
  close(): void;
}

/** `grpcSource` is a `Source` plus the gRPC-only multiplexed `subscribeMany`. */
export type GrpcSource<
  A extends AssetSchema = typeof uidAssetSchema,
  C extends string = string,
> = Source<A, C> & {
  readonly subscribeMany: (
    escrowIds: readonly Id<'Escrow'>[],
    opts?: SubscribeOpts,
  ) => ManySubscription<A, C>;
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

const EVENT_READ_MASK = {
  paths: [
    'transactions.timestamp',
    'transactions.events.events.event_type',
    'transactions.events.events.sender',
    'transactions.events.events.contents',
  ],
};

/** A protobuf Timestamp `{ seconds, nanos }` as an ISO-8601 string, or `null`. */
function isoTime(ts: unknown): string | null {
  const t = ts as { seconds?: bigint | string | number; nanos?: number } | undefined;
  if (t?.seconds == null) return null;
  return new Date(Number(t.seconds) * 1000 + (t.nanos ?? 0) / 1e6).toISOString();
}

/** Every event in a checkpoint as raw parts (the timestamp is the tx's). */
function* scanEvents(
  checkpoint: unknown,
): Generator<{ type: string; sender: string | null; timestamp: string | null; bytes: Uint8Array | null }> {
  const txs = (checkpoint as { transactions?: unknown[] })?.transactions ?? [];
  for (const tx of txs) {
    const t = tx as { timestamp?: unknown; events?: { events?: unknown[] } };
    const timestamp = isoTime(t.timestamp);
    for (const ev of t.events?.events ?? []) {
      const e = ev as { eventType?: string; sender?: string; contents?: { value?: Uint8Array } };
      if (e.eventType == null) continue;
      yield {
        type: e.eventType,
        sender: e.sender ?? null,
        timestamp,
        bytes: e.contents?.value ?? null,
      };
    }
  }
}

/**
 * A **server-push** stream of one escrow's typed events over the gRPC checkpoint
 * firehose. Widens the mask to carry events, decodes each with the same registry
 * as the indexer (no asset schema — events are self-contained codegen structs),
 * and keeps those whose payload `escrow_id` matches (and, if given, whose name is
 * in `kinds`). This is `escrow.history()` (pull) turned into a live feed (push).
 */
export async function* escrowEventStream(
  client: SuiGrpcClient,
  escrowId: Id<'Escrow'> | string,
  packageId: string,
  opts?: { signal?: AbortSignal; kinds?: readonly string[] },
): AsyncGenerator<TypedEvent> {
  const signal = opts?.signal;
  const want = normEscrowId(String(escrowId));
  const kinds = opts?.kinds ? new Set(opts.kinds) : null;
  let attempt = 0;
  while (!signal?.aborted) {
    const call = client.subscriptionService.subscribeCheckpoints(
      { readMask: EVENT_READ_MASK },
      signal ? { abort: signal } : {},
    );
    try {
      for await (const res of call.responses) {
        if (signal?.aborted) return;
        for (const part of scanEvents(res.checkpoint)) {
          // Cheap package filter before any decode (the firehose is chain-wide).
          if (!part.type.startsWith(packageId)) continue;
          const ev = typedEventFromBytes(part);
          if (ev.escrowId !== want) continue;
          if (kinds && !kinds.has(ev.name) && !kinds.has(eventKey(ev.type))) continue;
          yield ev;
        }
      }
      attempt = 0;
    } catch {
      if (signal?.aborted) return;
      const wait = RECONNECT_BACKOFF_MS[Math.min(attempt, RECONNECT_BACKOFF_MS.length - 1)]!;
      attempt += 1;
      await sleep(wait, signal);
    }
  }
}

const VERSION_READ_MASK = {
  paths: [
    'transactions.effects.changed_objects.object_id',
    'transactions.effects.changed_objects.output_version',
  ],
};

/**
 * A **decode-free** server-push signal: yields one escrow's new object version on
 * each on-chain change, via the checkpoint firehose. It reads only `object_id` +
 * `output_version` from checkpoint effects — no content fetch, no BCS, no asset
 * schema. The high-level `escrow.watch` consumes this and re-resolves its own
 * decode-free handle, so it gets push latency without decoding `EscrowState`
 * (which the full `subscribe` does, and which would need an asset schema).
 * Resumable: re-opens with bounded backoff; the per-version dedupe absorbs replays.
 */
export async function* escrowVersionChanges(
  client: SuiGrpcClient,
  escrowId: Id<'Escrow'> | string,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const core = client as unknown as ClientWithCoreApi;
  const target = normId(escrowId);
  let lastVersion: string | null = null;
  let primed = false;
  let attempt = 0;
  while (!signal?.aborted) {
    const call = client.subscriptionService.subscribeCheckpoints(
      { readMask: VERSION_READ_MASK },
      signal ? { abort: signal } : {},
    );
    try {
      for await (const res of call.responses) {
        if (signal?.aborted) return;
        // First checkpoint = the stream is live. Yield the current version once,
        // so the consumer captures any change that landed during subscribe setup
        // (a pure delta stream would miss a change in that gap forever).
        if (!primed) {
          primed = true;
          try {
            const { object } = await core.core.getObject({ objectId: escrowId });
            const v = String(object.version);
            if (v !== lastVersion) {
              lastVersion = v;
              yield v;
            }
          } catch {
            /* best-effort prime */
          }
        }
        for (const { objectId, version } of scanChanged(res.checkpoint)) {
          if (normId(objectId) === target && version !== lastVersion) {
            lastVersion = version;
            yield version;
          }
        }
      }
      attempt = 0; // clean completion → re-open from the latest checkpoint
    } catch {
      if (signal?.aborted) return;
      const wait = RECONNECT_BACKOFF_MS[Math.min(attempt, RECONNECT_BACKOFF_MS.length - 1)]!;
      attempt += 1;
      await sleep(wait, signal);
    }
  }
}

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

    subscribeMany(escrowIds, subOpts): ManySubscription<A, C> {
      const signal = subOpts?.signal;
      const watched = new Map<string, Id<'Escrow'>>(); // normId → branded id
      const seen = new Map<string, string>(); // normId → last post-tx version
      const out = channel<EscrowUpdate<A, C>>();
      const ac = new AbortController(); // stops the firehose on close

      const add = async (escrowId: Id<'Escrow'>): Promise<void> => {
        const n = normId(escrowId);
        if (watched.has(n)) return; // already watching
        watched.set(n, escrowId);
        const { state, version } = await fetchVersioned(escrowId);
        if (!watched.has(n)) return; // removed during the fetch
        seen.set(n, version);
        out.push({ escrowId, state });
      };

      const remove = (escrowId: Id<'Escrow'>): void => {
        const n = normId(escrowId);
        watched.delete(n);
        seen.delete(n);
      };

      const close = (): void => {
        signal?.removeEventListener('abort', close);
        ac.abort();
        out.close();
      };
      signal?.addEventListener('abort', close, { once: true });

      // Background: seed the initial ids (initials emit first), then demux the
      // shared firehose. The firehose gates on `seen`, so an id whose initial
      // fetch is still in flight is not double-emitted — its own fetch wins.
      void (async () => {
        await Promise.all(escrowIds.map(add));
        for await (const checkpoint of firehose(ac.signal)) {
          if (ac.signal.aborted) break;
          const hits = new Set<string>();
          for (const { objectId, version } of scanChanged(checkpoint)) {
            const n = normId(objectId);
            if (seen.has(n) && version !== seen.get(n)) hits.add(n);
          }
          for (const n of hits) {
            const escrowId = watched.get(n);
            if (!escrowId) continue; // removed since the scan
            const next = await fetchVersioned(escrowId);
            if (next.version === seen.get(n)) continue;
            seen.set(n, next.version);
            out.push({ escrowId, state: next.state });
          }
        }
        out.close();
      })();

      return {
        add,
        remove,
        close,
        [Symbol.asyncIterator]: () => out[Symbol.asyncIterator](),
      };
    },
  };
}
