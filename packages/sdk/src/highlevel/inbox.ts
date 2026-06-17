/**
 * The `Inbox` handle (Layer 2) — a coin-polymorphic income mailbox. One shape
 * for both bearer inboxes: the `EarningsInbox` (per-governor income) and the
 * `ProtocolFeeInbox` (the deployer's fee pool). Authority = holding the object.
 */
import { Transaction } from '@mysten/sui/transactions';
import { collectMessages, discoverInboxMessages, type InboxKind, type MessageGroups } from '../actions/collect.js';
import { transferOf } from './bearer.js';
import { resolveCoinInfo } from './coinmeta.js';
import { discoverIntegrated, type EscrowListing } from './listings.js';
import type { HandleCtx } from './ctx.js';
import { NotConnected, mapAbort } from './errors.js';
import { execute } from './send.js';
import { price, type Price } from './value.js';

export interface Inbox {
  readonly inboxId: string;
  /** Pending income per coin (preview, no collect). */
  balance(): Promise<Array<{ coin: string; amount: Price }>>;
  /** Collect everything, partitioned by coin (§5.2). Requires holding the inbox. */
  collect(): Promise<Array<{ coin: string; amount: Price }>>;
  /** Hand the inbox (and the right to collect) to another address. */
  transfer(to: string): Promise<{ digest: string }>;
  /**
   * The escrows whose settlements push messages into THIS inbox — object-centric,
   * the inbox answering for itself. The inbox→escrow link lives only in the event
   * log (`AssetIntegrated` sets the inbox id). For an `EarningsInbox` this is the
   * governor's portfolio paying in; for the `ProtocolFeeInbox` (a singleton) it's
   * every escrow of the deployment. Decode-free `EscrowListing`s. Needs `graphql`.
   */
  escrowsPushingMessages(): Promise<EscrowListing[]>;
}

/** The governor's income mailbox. */
export type EarningsInbox = Inbox;
/** The deployer's protocol-fee pool. */
export type ProtocolFeeInbox = Inbox;

async function sumGroups(
  client: HandleCtx['client'],
  groups: MessageGroups,
): Promise<Array<{ coin: string; amount: Price }>> {
  return Promise.all(
    [...groups].map(async ([coin, refs]) => ({
      coin,
      amount: price(refs.reduce((a, r) => a + r.amountMist, 0n), await resolveCoinInfo(client, coin)),
    })),
  );
}

/** Build an `Inbox` handle for an `EarningsInbox` (`'earnings'`) or `ProtocolFeeInbox` (`'fees'`). */
export function createInbox(ctx: HandleCtx, inboxId: string, kind: InboxKind): Inbox {
  const { client, packageId, signer } = ctx;
  const pkg = { packageId };
  return {
    inboxId,
    async balance() {
      return sumGroups(client, await discoverInboxMessages(client, inboxId, kind));
    },
    async collect() {
      if (signer == null) throw new NotConnected(`${kind} collect requires a signer (you must hold the inbox)`);
      const groups = await discoverInboxMessages(client, inboxId, kind);
      if (groups.size === 0) return [];
      const tx = new Transaction();
      const coins = collectMessages({ kind, groups }).toPtb(tx, { pkg, inboxId });
      tx.transferObjects(coins, signer.toSuiAddress());
      await execute(client, tx, signer).catch(mapAbort);
      return sumGroups(client, groups);
    },
    transfer: transferOf(ctx, inboxId, `${kind} inbox`),
    escrowsPushingMessages() {
      return discoverIntegrated(ctx, kind === 'fees' ? { feeInboxId: inboxId } : { earningsInboxId: inboxId });
    },
  };
}
