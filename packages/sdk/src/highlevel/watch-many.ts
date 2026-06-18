/**
 * Portfolio watch (Layer 2) — `watchMany` is the many-escrow twin of
 * `escrow.watch`. It emits a re-resolved, decode-free `Escrow` handle on every
 * on-chain change across a *set* of escrows, over **one** gRPC firehose
 * (`escrowVersionChangesMany`), with a live-editable set. Same resilience rule as
 * the single watch: a transient resolve flake skips a tick, never ends the watch.
 *
 * Re-resolutions are **coalesced**: version signals that arrive in the same turn
 * (the initial seed, or several escrows changed in one checkpoint — the firehose
 * pushes those synchronously) are resolved together via `createEscrowMany`, one
 * batch of reads instead of one per escrow. A batch flake falls back to per-escrow
 * so a single bad escrow never skips the others.
 *
 * Like the single watch it degrades to polling only when no gRPC client is
 * available (a non-gRPC client and no network) — then it runs one version-poll
 * loop per id.
 */
import type { HandleCtx } from './ctx.js';
import { createEscrow, createEscrowMany, type Escrow } from './escrow.js';
import { escrowVersionChangesMany } from '../primitives/grpc-source.js';

/** A live portfolio watch: grow/shrink the set in flight, then `stop()`. */
export interface PortfolioWatch {
  /** Start watching another escrow (emits its current handle, then changes). */
  add(escrowId: string): void;
  /** Stop watching one escrow (no further emissions for it). */
  remove(escrowId: string): void;
  /** End the whole watch and release the stream. */
  stop(): void;
}

export function watchMany(
  ctx: HandleCtx,
  escrowIds: readonly string[],
  onChange: (e: Escrow) => void,
  opts?: { intervalMs?: number },
): PortfolioWatch {
  let stopped = false;

  // Coalescing emitter: signals arriving in the same turn resolve together via
  // one `createEscrowMany`. A transient batch flake retries per-escrow (and a
  // per-escrow flake skips only that one) — a flake must NOT end the watch.
  const pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = async () => {
    timer = null;
    const ids = [...pending];
    pending.clear();
    if (stopped || ids.length === 0) return;
    try {
      const snaps = await createEscrowMany(ctx, ids);
      if (!stopped) for (const s of snaps) onChange(s);
    } catch {
      // Batch failed — fall back to per-escrow so one bad escrow can't skip the rest.
      for (const id of ids) {
        try {
          const snap = await createEscrow(ctx, id);
          if (!stopped) onChange(snap);
        } catch {
          /* transient per-escrow flake — skip, keep watching */
        }
      }
    }
  };
  // Schedule a batched re-resolution. `setTimeout(0)` lets the current turn's
  // whole burst (a checkpoint's changes, the initial seed) collect first.
  const emit = (escrowId: string) => {
    pending.add(escrowId);
    if (timer == null) timer = setTimeout(() => void flush(), 0);
  };

  // PUSH: one firehose, demultiplexed by id (decode-free version signals).
  const grpc = ctx.grpcClient;
  if (grpc) {
    const sub = escrowVersionChangesMany(grpc, escrowIds);
    void (async () => {
      for await (const { escrowId } of sub) {
        if (stopped) break;
        emit(escrowId); // collect; the coalescer batches the resolution
      }
    })();
    return {
      add: (escrowId) => void sub.add(escrowId),
      remove: (escrowId) => {
        pending.delete(escrowId);
        sub.remove(escrowId);
      },
      stop: () => {
        stopped = true;
        if (timer != null) clearTimeout(timer);
        sub.close();
      },
    };
  }

  // POLL fallback (no gRPC): one version-poll loop per id, started/stopped on demand.
  const intervalMs = opts?.intervalMs ?? 3000;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const stoppers = new Map<string, () => void>();

  const start = (escrowId: string) => {
    if (stoppers.has(escrowId)) return;
    let local = false;
    stoppers.set(escrowId, () => {
      local = true;
    });
    let lastVersion: string | null = null;
    void (async () => {
      // Prime: emit the current handle once (coalesced with the rest of the set).
      try {
        const { object } = await ctx.client.core.getObject({ objectId: escrowId });
        lastVersion = String(object.version);
      } catch {
        /* best-effort prime */
      }
      emit(escrowId);
      while (!stopped && !local) {
        await sleep(intervalMs);
        if (stopped || local) break;
        try {
          const { object } = await ctx.client.core.getObject({ objectId: escrowId });
          const v = String(object.version);
          if (v !== lastVersion) {
            lastVersion = v;
            emit(escrowId);
          }
        } catch {
          /* transient read error — keep polling */
        }
      }
    })();
  };

  for (const id of escrowIds) start(id);

  return {
    add: (escrowId) => start(escrowId),
    remove: (escrowId) => {
      pending.delete(escrowId);
      stoppers.get(escrowId)?.();
      stoppers.delete(escrowId);
    },
    stop: () => {
      stopped = true;
      if (timer != null) clearTimeout(timer);
      for (const s of stoppers.values()) s();
      stoppers.clear();
    },
  };
}
