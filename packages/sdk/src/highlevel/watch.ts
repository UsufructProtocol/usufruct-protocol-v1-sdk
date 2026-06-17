/**
 * Shared single-escrow version subscribe (Layer 2). The escrow is the unit of
 * change on-chain; both `escrow.watch` (emit a fresh escrow snapshot) and
 * `usufructCap.watch` (emit the seat's fresh state) react to the *same* signal —
 * the escrow object's version changing. This is that one loop, reused.
 *
 * PUSH over the gRPC checkpoint firehose (decode-free: just object_id + version)
 * when a gRPC client is configured; else version-poll. A transient flake skips a
 * tick — it must never end the watch (or a `waitFor` would hang).
 */
import type { Id } from '../primitives/brand.js';
import { escrowVersionChanges } from '../primitives/grpc-source.js';
import type { HandleCtx } from './ctx.js';

/**
 * Run `onTick` once immediately (the initial state), then on every version change
 * of `escrowId`, until the returned stop is called. `onTick` is given an `alive()`
 * predicate so it can drop a late emission after stop (the callback fires post-IO).
 */
export function subscribeEscrowVersion(
  ctx: HandleCtx,
  escrowId: Id<'Escrow'> | string,
  onTick: (alive: () => boolean) => Promise<void> | void,
  opts?: { intervalMs?: number },
): () => void {
  let stopped = false;
  const alive = (): boolean => !stopped;
  const tick = async (): Promise<void> => {
    try {
      if (!stopped) await onTick(alive);
    } catch {
      /* transient flake — skip this tick, keep watching */
    }
  };

  // PUSH: server-push version changes off the firehose.
  const grpc = ctx.grpcClient;
  if (grpc) {
    const controller = new AbortController();
    void (async () => {
      try {
        await tick(); // initial
        const changes = escrowVersionChanges(grpc, escrowId, controller.signal)[Symbol.asyncIterator]();
        while (!stopped) {
          if ((await changes.next()).done) break;
          await tick();
        }
      } catch {
        /* aborted or stream error */
      }
    })();
    return () => {
      stopped = true;
      controller.abort();
    };
  }

  // POLL fallback (no gRPC): version-poll the object.
  const intervalMs = opts?.intervalMs ?? 3000;
  let lastVersion: string | null = null;
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
  void (async () => {
    while (!stopped) {
      try {
        const { object } = await ctx.client.core.getObject({ objectId: escrowId });
        const v = String(object.version);
        if (v !== lastVersion) {
          lastVersion = v;
          await tick();
        }
      } catch {
        /* transient read error — keep polling */
      }
      if (!stopped) await sleep(intervalMs);
    }
  })();
  return () => {
    stopped = true;
  };
}
