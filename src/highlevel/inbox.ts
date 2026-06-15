/**
 * The `Inbox` handle (Layer 2) — a coin-polymorphic income mailbox. One shape
 * for both bearer inboxes: the `EarningsInbox` (per-governor income) and the
 * `ProtocolFeeInbox` (the deployer's fee pool). Authority = holding the object.
 */
import { Transaction } from '@mysten/sui/transactions';
import { collectMessages, discoverInboxMessages, type InboxKind, type MessageGroups } from '../actions/collect.js';
import { transferOf } from './bearer.js';
import type { HandleCtx } from './ctx.js';
import { NotConnected, mapAbort } from './errors.js';
import { execute } from './send.js';
import { coinInfo, price, type Price } from './value.js';

export interface Inbox {
  readonly inboxId: string;
  /** Pending income per coin (preview, no collect). */
  balance(): Promise<Array<{ coin: string; amount: Price }>>;
  /** Collect everything, partitioned by coin (§5.2). Requires holding the inbox. */
  collect(): Promise<Array<{ coin: string; amount: Price }>>;
  /** Hand the inbox (and the right to collect) to another address. */
  transfer(to: string): Promise<{ digest: string }>;
}

/** The governor's income mailbox. */
export type EarningsInbox = Inbox;
/** The deployer's protocol-fee pool. */
export type ProtocolFeeInbox = Inbox;

function sumGroups(groups: MessageGroups): Array<{ coin: string; amount: Price }> {
  return [...groups].map(([coin, refs]) => ({
    coin,
    amount: price(refs.reduce((a, r) => a + r.amountMist, 0n), coinInfo(coin)),
  }));
}

/** Build an `Inbox` handle for an `EarningsInbox` (`'earnings'`) or `ProtocolFeeInbox` (`'fees'`). */
export function createInbox(ctx: HandleCtx, inboxId: string, kind: InboxKind): Inbox {
  const { client, packageId, signer } = ctx;
  const pkg = { packageId };
  return {
    inboxId,
    async balance() {
      return sumGroups(await discoverInboxMessages(client, inboxId, kind));
    },
    async collect() {
      if (signer == null) throw new NotConnected(`${kind} collect requires a signer (you must hold the inbox)`);
      const groups = await discoverInboxMessages(client, inboxId, kind);
      if (groups.size === 0) return [];
      const tx = new Transaction();
      const coins = collectMessages({ kind, groups }).toPtb(tx, { pkg, inboxId });
      tx.transferObjects(coins, signer.toSuiAddress());
      await execute(client, tx, signer).catch(mapAbort);
      return sumGroups(groups);
    },
    transfer: transferOf(ctx, inboxId, `${kind} inbox`),
  };
}
