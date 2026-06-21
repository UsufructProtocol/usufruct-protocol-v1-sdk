/**
 * The `Inbox` handle (Layer 2) — a coin-polymorphic income mailbox. One shape
 * for both bearer inboxes: the `EarningsInbox` (per-governor income) and the
 * `ProtocolFeeInbox` (the deployer's fee pool). Authority = holding the object.
 */
import { collectMessagesToPtb, discoverInboxMessages, type InboxKind, type MessageGroups } from '../actions/collect.js';
import { packageEventStream } from '../primitives/grpc-source.js';
import { normEscrowId } from '../indexer/events.js';
import { transferOf } from './bearer.js';
import { makePlan, type Plan } from './plan.js';
import { resolveCoinInfo } from './coinmeta.js';
import { discoverIntegrated, type EscrowListing } from './listings.js';
import type { HandleCtx } from './ctx.js';
import { UsufructError } from './errors.js';
import { price, type Price } from './value.js';

/** One income message pushed into the inbox — a settlement paying in, per coin. */
export interface InboxMessage {
  readonly coin: string;
  readonly amount: Price;
  /** The escrow whose settlement produced it. */
  readonly escrowId: string | null;
  readonly at: Date | null;
}

/** Lifetime income in one coin — the sum of every message ever posted in it. */
export interface InboxTotal {
  readonly coin: string;
  readonly total: Price;
  /** How many settlements paid in (in this coin). */
  readonly count: number;
}

// ── the four-verb surface (additive; no nav — an inbox relates to escrows via the
//    collection that pays in → inspect, not a single edge). ──
/** read — the uncollected balance, now. */
export interface InboxReadVerb {
  balance(): Promise<Array<{ coin: string; amount: Price }>>;
}
/** inspect — the event log / discovery (pull). */
export interface InboxInspectVerb {
  history(opts?: { afterCheckpoint?: number; beforeCheckpoint?: number }): Promise<InboxMessage[]>;
  totals(opts?: { afterCheckpoint?: number; beforeCheckpoint?: number }): Promise<InboxTotal[]>;
  escrowsPushingMessages(): Promise<EscrowListing[]>;
}
/** react — the event log (push). */
export interface InboxReactVerb {
  watch(onMessage: (m: InboxMessage) => void): () => void;
}
/** write — protocol writes (Plan). */
export interface InboxWriteVerb {
  collect(): Plan<Array<{ coin: string; amount: Price }>>;
  transfer(to: string): Plan<{ digest: string }>;
}

export interface Inbox {
  // identity — the object's name. All operations are verbs (no nav: an inbox relates
  // to escrows via the collection that pays in → inspect, not a single edge).
  readonly inboxId: string;

  readonly read: InboxReadVerb;
  readonly inspect: InboxInspectVerb;
  readonly react: InboxReactVerb;
  readonly write: InboxWriteVerb;
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
  const { client, packageId, grpcClient } = ctx;
  const pkg = { packageId };
  // The Posted event + its inbox-id field, by inbox kind.
  const eventName = kind === 'fees' ? 'FeeMessagePosted' : 'EarningsMessagePosted';
  const inboxField = kind === 'fees' ? 'fee_inbox_id' : 'earnings_inbox_id';
  const postedType = `${packageId}::${kind === 'fees' ? 'fee_message' : 'earnings_message'}::${eventName}`;
  const want = normEscrowId(inboxId);

  async function history(historyOpts?: { afterCheckpoint?: number; beforeCheckpoint?: number }): Promise<InboxMessage[]> {
    if (ctx.indexer == null) {
      throw new UsufructError('history requires a GraphQL endpoint — pass `graphql` to usufruct()');
    }
    const out: InboxMessage[] = [];
    for await (const ev of ctx.indexer.events({
      type: postedType,
      ...(historyOpts?.afterCheckpoint !== undefined ? { afterCheckpoint: historyOpts.afterCheckpoint } : {}),
      ...(historyOpts?.beforeCheckpoint !== undefined ? { beforeCheckpoint: historyOpts.beforeCheckpoint } : {}),
    })) {
      if (normEscrowId(String(ev.data[inboxField] ?? '')) !== want) continue;
      const coin = String(ev.data['coin_type'] ?? '');
      out.push({
        coin,
        amount: price(BigInt(String(ev.data['amount'] ?? '0')), await resolveCoinInfo(client, coin)),
        escrowId: ev.escrowId,
        at: ev.timestamp ? new Date(ev.timestamp) : null,
      });
    }
    return out;
  }

  async function totals(totalsOpts?: { afterCheckpoint?: number; beforeCheckpoint?: number }): Promise<InboxTotal[]> {
    const sums = new Map<string, { mist: bigint; count: number }>();
    for (const m of await history(totalsOpts)) {
      const cur = sums.get(m.coin) ?? { mist: 0n, count: 0 };
      sums.set(m.coin, { mist: cur.mist + m.amount.mist, count: cur.count + 1 });
    }
    return Promise.all(
      [...sums.entries()].map(async ([coin, { mist, count }]) => ({
        coin,
        total: price(mist, await resolveCoinInfo(client, coin)),
        count,
      })),
    );
  }

  // Internal scaffolding: the closures the verbs delegate to, typed by the verb
  // interfaces so their params keep contextual types (the public handle is verbs-only).
  const g: { inboxId: string } & InboxReadVerb &
    InboxInspectVerb &
    InboxReactVerb &
    InboxWriteVerb = {
    inboxId,
    async balance() {
      return sumGroups(client, await discoverInboxMessages(client, inboxId, kind));
    },
    collect() {
      // Groups discovered at build time, summed at decode time (the result comes
      // from the discovered messages, not the effects). Empty ⇒ no commands ⇒
      // `send` short-circuits to [].
      let groups: MessageGroups = new Map();
      return makePlan({
        defaultExecutor: () => ctx.defaultExecutor,
        build: async (tx, sender) => {
          groups = await discoverInboxMessages(client, inboxId, kind);
          if (groups.size === 0) return;
          const coins = collectMessagesToPtb({ kind, groups })(tx, { pkg, inboxId });
          tx.transferObjects(coins, sender);
        },
        decode: async () => sumGroups(client, groups),
      });
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
    history,
    totals,
    escrowsPushingMessages() {
      return discoverIntegrated(ctx, kind === 'fees' ? { feeInboxId: inboxId } : { earningsInboxId: inboxId });
    },
  };

  const read: InboxReadVerb = { balance: g.balance };
  const inspect: InboxInspectVerb = {
    history: g.history,
    totals: g.totals,
    escrowsPushingMessages: g.escrowsPushingMessages,
  };
  const react: InboxReactVerb = { watch: g.watch };
  const write: InboxWriteVerb = { collect: g.collect, transfer: g.transfer };

  return { inboxId: g.inboxId, read, inspect, react, write };
}
