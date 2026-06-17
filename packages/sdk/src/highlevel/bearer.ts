/**
 * Bearer-object plumbing (Layer 2). The four capability objects are `key +
 * store` — freely transferable. Moving the object moves the role, so `transfer`
 * is a first-class operation on every capability handle, not an afterthought.
 */
import type { HandleCtx } from './ctx.js';
import { digestPlan, type Plan } from './plan.js';

/** Build a `transfer(to)` for an owned object — a `Plan` the current holder sends. */
export function transferOf(
  ctx: HandleCtx,
  objectId: string,
): (to: string) => Plan<{ digest: string }> {
  return (to) =>
    digestPlan(
      () => ctx.defaultExecutor,
      (tx) => {
        tx.transferObjects([tx.object(objectId)], to);
      },
    );
}
