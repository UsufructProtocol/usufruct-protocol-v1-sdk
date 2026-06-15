/**
 * Bearer-object plumbing (Layer 2). The four capability objects are `key +
 * store` — freely transferable. Moving the object moves the role, so `transfer`
 * is a first-class operation on every capability handle, not an afterthought.
 */
import { Transaction } from '@mysten/sui/transactions';
import type { HandleCtx } from './ctx.js';
import { NotConnected, mapAbort } from './errors.js';
import { execute } from './send.js';

/** Build a `transfer(to)` for an owned object, signed by its current holder. */
export function transferOf(
  ctx: HandleCtx,
  objectId: string,
  label: string,
): (to: string) => Promise<{ digest: string }> {
  return async (to) => {
    const s = ctx.signer;
    if (s == null) throw new NotConnected(`${label}.transfer requires a signer (you must hold the object)`);
    const tx = new Transaction();
    tx.transferObjects([tx.object(objectId)], to);
    const res = await execute(ctx.client, tx, s).catch(mapAbort);
    return { digest: res.digest };
  };
}
