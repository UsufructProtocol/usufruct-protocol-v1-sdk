/**
 * Portfolio watch (Layer 2) — `watchMany` is the many-escrow twin of
 * `escrow.watch`. It emits a re-resolved, decode-free `Escrow` handle on every
 * on-chain change across a *set* of escrows, over **one** gRPC firehose
 * (`escrowVersionChangesMany`), with a live-editable set. Same resilience rule as
 * the single watch: a transient resolve flake skips a tick, never ends the watch.
 *
 * Like the single watch it degrades to polling only when no gRPC client is
 * available (a non-gRPC client and no network) — then it runs one version-poll
 * loop per id.
 */
import type { HandleCtx } from './ctx.js';
import { createEscrow, type Escrow } from './escrow.js';
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

  // Re-resolve the decode-free handle and hand it to the callback. A transient
  // read flake skips this tick — it must NOT end the watch.
  const emit = async (escrowId: string) => {
    try {
      const snap = await createEscrow(ctx, escrowId);
      if (!stopped) onChange(snap);
    } catch {
      /* transient resolve flake — skip, keep watching */
    }
  };

  // PUSH: one firehose, demultiplexed by id (decode-free version signals).
  const grpc = ctx.grpcClient;
  if (grpc) {
    const sub = escrowVersionChangesMany(grpc, escrowIds);
    void (async () => {
      for await (const { escrowId } of sub) {
        if (stopped) break;
        await emit(escrowId);
      }
    })();
    return {
      add: (escrowId) => void sub.add(escrowId),
      remove: (escrowId) => sub.remove(escrowId),
      stop: () => {
        stopped = true;
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
      // Prime: emit the current handle once.
      try {
        const { object } = await ctx.client.core.getObject({ objectId: escrowId });
        lastVersion = String(object.version);
      } catch {
        /* best-effort prime */
      }
      await emit(escrowId);
      while (!stopped && !local) {
        await sleep(intervalMs);
        if (stopped || local) break;
        try {
          const { object } = await ctx.client.core.getObject({ objectId: escrowId });
          const v = String(object.version);
          if (v !== lastVersion) {
            lastVersion = v;
            await emit(escrowId);
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
      stoppers.get(escrowId)?.();
      stoppers.delete(escrowId);
    },
    stop: () => {
      stopped = true;
      for (const s of stoppers.values()) s();
      stoppers.clear();
    },
  };
}
