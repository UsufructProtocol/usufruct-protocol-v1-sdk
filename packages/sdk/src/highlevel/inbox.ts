/**
 * The `Inbox` handle (Layer 2) — a coin-polymorphic income mailbox. One shape
 * for both bearer inboxes: the `EarningsInbox` (per-governor income) and the
 * `ProtocolFeeInbox` (the deployer's fee pool). Authority = holding the object.
 */
import { Transaction } from '@mysten/sui/transactions';
import { collectMessages, discoverInboxMessages, type InboxKind, type MessageGroups } from '../actions/collect.js';
import { packageEventStream } from '../primitives/grpc-source.js';
import { normEscrowId } from '../indexer/events.js';
import { transferOf } from './bearer.js';
import type { Plan } from './plan.js';
import { resolveCoinInfo } from './coinmeta.js';
import { discoverIntegrated, type EscrowListing } from './listings.js';
import type { HandleCtx } from './ctx.js';
import { NotConnected, UsufructError, mapAbort } from './errors.js';
import { execute } from './send.js';
import { price, type Price } from './value.js';

/** One income message pushed into the inbox — a settlement paying in, per coin. */
export interface InboxMessage {
  readonly coin: string;
  readonly amount: Price;
  /** The escrow whose settlement produced it. */
  readonly escrowId: string | null;
  readonly at: Date | null;
}

export interface Inbox {
  readonly inboxId: string;
  /** Pending income per coin (preview, no collect). */
  balance(): Promise<Array<{ coin: string; amount: Price }>>;
  /** Collect everything, partitioned by coin (§5.2). Requires holding the inbox. */
  collect(): Promise<Array<{ coin: string; amount: Price }>>;
  /** Hand the inbox (and the right to collect) to another address. */
  transfer(to: string): Plan<{ digest: string }>;
  /**
   * React to income live: `onMessage` runs for each settlement pushed into THIS
   * inbox (typed, per coin), server-push over the gRPC firehose. The inbox's twin
   * of `escrow.on` — keyed on the inbox id across every escrow paying in (an
   * `EarningsInbox` hears its governor's portfolio; the `ProtocolFeeInbox` hears
   * the whole deployment). Returns a `stop()`. Needs a gRPC client (the SDK default).
   */
  watch(onMessage: (m: InboxMessage) => void): () => void;
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
  const { client, packageId, signer, grpcClient } = ctx;
  const pkg = { packageId };
  // The Posted event + its inbox-id field, by inbox kind.
  const eventName = kind === 'fees' ? 'FeeMessagePosted' : 'EarningsMessagePosted';
  const inboxField = kind === 'fees' ? 'fee_inbox_id' : 'earnings_inbox_id';
  const want = normEscrowId(inboxId);
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
    transfer: transferOf(ctx, inboxId),
    watch(onMessage: (m: InboxMessage) => void): () => void {
      if (grpcClient == null) {
        throw new UsufructError('watch requires a gRPC client (live event push) — the SDK default');
      }
      const controller = new AbortController();
      void (async () => {
        try {
          const stream = packageEventStream(grpcClient, packageId, {
            signal: controller.signal,
            kinds: [eventName],
            where: (ev) => normEscrowId(String(ev.data[inboxField] ?? '')) === want,
          });
          for await (const ev of stream) {
            if (controller.signal.aborted) break;
            const coin = String(ev.data['coin_type'] ?? '');
            const msg: InboxMessage = {
              coin,
              amount: price(BigInt(String(ev.data['amount'] ?? '0')), await resolveCoinInfo(client, coin)),
              escrowId: ev.escrowId,
              at: ev.timestamp ? new Date(ev.timestamp) : null,
            };
            try {
              onMessage(msg);
            } catch {
              /* a consumer error must not kill the stream */
            }
          }
        } catch {
          /* aborted or stream error */
        }
      })();
      return () => controller.abort();
    },
    escrowsPushingMessages() {
      return discoverIntegrated(ctx, kind === 'fees' ? { feeInboxId: inboxId } : { earningsInboxId: inboxId });
    },
  };
}
