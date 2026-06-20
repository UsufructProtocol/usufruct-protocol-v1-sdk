/**
 * Ledger reconstruction — the economic record of a settlement, replayed drift-zero
 * from the event log (the counterpart to `timeline.ts`, which replays the curves).
 *
 * Two pure projections over an escrow's decoded `HistoryEvent[]`:
 *   reconstructStatement — one renter cap's P&L (paid / refunded / consumed)
 *   reconstructTenancies — the asset's occupancy intervals, with per-tenancy economics
 *
 * Both render amounts as `Price` in the escrow's single coin; like the timeline
 * methods they re-derive nothing on-chain — they sum the amounts the chain settled.
 */
import type { HistoryEvent } from './history.js';
import { price, type CoinInfo, type Price } from './value.js';

const u64 = (v: unknown): bigint => BigInt(v as string | number | bigint);
const norm = (v: unknown): string => String(v ?? '').replace(/^0x/, '').toLowerCase();
const atOf = (e: HistoryEvent): Date => e.at ?? new Date(Number(u64(e.data['timestamp_ms'])));

// ── renter statement ───────────────────────────────────────────────────────

/** Where a cap ended up — the shape of its journey. `pending`: a bid not yet resolved;
 *  `active`: holds the seat now; the rest are closed outcomes. */
export type RenterStatus = 'active' | 'pending' | 'expired' | 'displaced' | 'superseded';

/** One `UsufructCap`'s P&L: paid once on acquisition, then consumed and/or refunded. */
export interface RenterStatement {
  readonly capId: string;
  /** Acquisition cost (rent price, or bid amount). */
  readonly paid: Price;
  /** Returned stake — superseded as a challenger, or displaced as the occupant. */
  readonly refunded: Price;
  /** Credit actually spent on usage (the renter's real cost). */
  readonly consumed: Price;
  /** Unspent stake still at risk — live, only while `active` (refund-if-displaced-now). */
  readonly remaining: Price | null;
  readonly status: RenterStatus;
}

/**
 * Sum a cap's paid/refunded/consumed from the events that name it. Closed caps settle
 * fully in the log (`paid == consumed + refunded`); for an `active` cap the handle
 * overlays the live `remaining`/`consumed` (the log has not settled it yet).
 */
export function reconstructStatement(events: readonly HistoryEvent[], capId: string, coin: CoinInfo): RenterStatement {
  const want = norm(capId);
  let paid = 0n, refunded = 0n, consumed = 0n;
  let occupied = false; //  ever held the seat (rent, or won a handover)
  let pending = false; //   placed a bid not yet resolved
  let terminal: RenterStatus | null = null; // a closed outcome, last one wins

  for (const e of events) {
    const d = e.data;
    if (e.kind === 'RentStarted' && norm(d['usufruct_cap_id']) === want) {
      paid += u64(d['price_paid']);
      occupied = true;
      terminal = null;
    } else if ((e.kind === 'BidPlaced' || e.kind === 'BidSuperseded') && norm(d['pending_usufruct_cap_id']) === want) {
      paid += u64(d['pending_bid_amount']);
      pending = true;
    }
    if (e.kind === 'BidSuperseded' && norm(d['displaced_usufruct_cap_id']) === want) {
      refunded += u64(d['refunded_amount']);
      pending = false;
      terminal = 'superseded';
    }
    if (e.kind === 'HandoverCompleted') {
      if (norm(d['active_usufruct_cap_id']) === want) {
        occupied = true; //   won the seat
        pending = false;
        terminal = null;
      }
      if (norm(d['departing_usufruct_cap_id']) === want) {
        consumed += u64(d['used_credit']);
        refunded += u64(d['departing_refund_amount']);
        occupied = false;
        terminal = 'displaced';
      }
    }
    if (e.kind === 'TenureExpired' && norm(d['usufruct_cap_id']) === want) {
      consumed += u64(d['governor_share']) + u64(d['protocol_fee']);
      occupied = false;
      terminal = 'expired';
    }
  }

  const status: RenterStatus = terminal ?? (occupied ? 'active' : pending ? 'pending' : 'superseded');
  return {
    capId,
    paid: price(paid, coin),
    refunded: price(refunded, coin),
    consumed: price(consumed, coin),
    // pending stake is fully at risk (refundable in full); active is overlaid live; closed has none.
    remaining: status === 'pending' ? price(paid - refunded - consumed, coin) : null,
    status,
  };
}

// ── governor revenue ─────────────────────────────────────────────────────────

/** A governor's lifetime earnings from one escrow, per coin it was priced in. */
export interface EscrowRevenue {
  readonly escrowId: string;
  readonly earnings: ReadonlyArray<{ readonly coin: string; readonly total: Price; readonly count: number }>;
}

// ── occupancy ledger ───────────────────────────────────────────────────────

/** One occupation interval — who held the asset, what they paid, how it settled. */
export interface Tenancy {
  readonly capId: string;
  readonly usufructuary: string;
  readonly startedAt: Date;
  /** `null` while still occupying. */
  readonly endedAt: Date | null;
  /** What they paid to take the seat (rent price, or winning bid). */
  readonly acquired: Price;
  readonly ceilingMs: number;
  // settlement (null until the tenancy ends)
  readonly usedCredit: Price | null;
  readonly refund: Price | null;
  readonly governorShare: Price | null;
  readonly protocolFee: Price | null;
}

interface OpenTenancy {
  capId: string;
  usufructuary: string;
  startedAt: Date;
  acquiredMist: bigint;
  ceilingMs: number;
}

/**
 * Walk the escrow's events into occupation intervals. A tenancy opens on `RentStarted`
 * (fresh) or `HandoverCompleted` (the new active occupant) and closes on `TenureExpired`
 * or the next `HandoverCompleted` (the departing occupant). Bids/supersedes touch the
 * pending challenger, not the occupant, so they are not boundaries here. Oldest first.
 */
export function reconstructTenancies(events: readonly HistoryEvent[], coin: CoinInfo): Tenancy[] {
  const out: Tenancy[] = [];
  const st: { cur: OpenTenancy | null } = { cur: null }; // holder (CFA across the closures)

  const open = (capId: unknown, addr: unknown, at: Date, acquiredMist: bigint, ceilingMs: number) => {
    st.cur = { capId: String(capId), usufructuary: String(addr), startedAt: at, acquiredMist, ceilingMs };
  };
  const close = (at: Date, s: { usedCredit: bigint; refund: bigint; governorShare: bigint; protocolFee: bigint }) => {
    const c = st.cur;
    if (!c) return;
    out.push({
      capId: c.capId,
      usufructuary: c.usufructuary,
      startedAt: c.startedAt,
      endedAt: at,
      acquired: price(c.acquiredMist, coin),
      ceilingMs: c.ceilingMs,
      usedCredit: price(s.usedCredit, coin),
      refund: price(s.refund, coin),
      governorShare: price(s.governorShare, coin),
      protocolFee: price(s.protocolFee, coin),
    });
    st.cur = null;
  };

  for (const e of events) {
    const d = e.data;
    const at = atOf(e);
    if (e.kind === 'RentStarted') {
      open(d['usufruct_cap_id'], d['usufructuary_address'], at, u64(d['price_paid']), Number(u64(d['ceiling_total_ms'])));
    } else if (e.kind === 'TenureExpired') {
      close(at, { usedCredit: u64(d['governor_share']) + u64(d['protocol_fee']), refund: 0n, governorShare: u64(d['governor_share']), protocolFee: u64(d['protocol_fee']) });
    } else if (e.kind === 'HandoverCompleted') {
      close(at, { usedCredit: u64(d['used_credit']), refund: u64(d['departing_refund_amount']), governorShare: u64(d['governor_share']), protocolFee: u64(d['protocol_fee']) });
      open(d['active_usufruct_cap_id'], d['active_usufructuary_address'], at, u64(d['active_stake_balance']), Number(u64(d['ceiling_total_ms'])));
    }
  }

  const tail = st.cur;
  if (tail) {
    out.push({
      capId: tail.capId,
      usufructuary: tail.usufructuary,
      startedAt: tail.startedAt,
      endedAt: null,
      acquired: price(tail.acquiredMist, coin),
      ceilingMs: tail.ceilingMs,
      usedCredit: null,
      refund: null,
      governorShare: null,
      protocolFee: null,
    });
  }
  return out;
}
