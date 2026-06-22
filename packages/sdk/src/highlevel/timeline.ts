/**
 * Historical curve reconstruction — replay an escrow's event log into the curves
 * the chain computed, drift-zero.
 *
 * Every continuous curve (credit accrual, Dutch-auction descent) is rebuilt from
 * event-sourced params + the per-cycle shape carried in `CycleParamsResolved`, by
 * running the deployed parameterized views (`read/curve.ts`) — one shape built
 * on-chain, reused across N sample points per simulation. The shape the SDK feeds
 * the view is the same enum it decodes from the event, so reconstruction can't
 * drift from the chain's own math (it IS the chain's math).
 *
 * The `escrow` handle exposes these as `creditHistory`/`priceTimeline` and the
 * single-segment `creditCurve`/`descentCurve`.
 */
import type { ClientWithCoreApi } from '@mysten/sui/client';
import {
  sampleCreditCurve,
  sampleDescentCurve,
  type CurveShape,
} from '../read/curve.js';
import type { HistoryEvent } from './history.js';
import { price, type CoinInfo, type Price } from './value.js';

/** One sampled point on a reconstructed curve. */
export interface CurvePoint {
  /** Absolute chain time (ms). */
  readonly atMs: number;
  /** Offset from the curve's phase start (ms). */
  readonly offsetMs: number;
  readonly value: Price;
}

/** A tenure's credit-accrual curve, as the chain accrued it. */
export interface CreditSegment {
  /** The occupant's usufruct cap (active at this tenure), if the event carried it. */
  readonly capId: string | null;
  /** Stake principal credit accrues against. */
  readonly principal: Price;
  readonly shape: CurveShape;
  readonly startedAt: Date;
  readonly ceilingMs: number;
  readonly points: readonly CurvePoint[];
}

/** A Dutch-auction descent curve, from the last-acquisition ceiling to the rest floor. */
export interface DescentSegment {
  readonly shape: CurveShape;
  readonly startedAt: Date;
  readonly descentMs: number;
  /** Where the descent starts (last acquisition price). */
  readonly from: Price;
  /** Where it bottoms out (the cycle's rest floor). */
  readonly to: Price;
  readonly points: readonly CurvePoint[];
}

/** A discrete price event on the timeline (an acquisition / displacement). */
export interface PriceMarker {
  readonly kind: 'rent' | 'bid' | 'supersede' | 'handover';
  readonly at: Date;
  readonly price: Price;
  readonly by: string | null;
}

/** The price line as ordered segments: discrete acquisition prices + descent curves. */
export type TimelineSegment = PriceMarker | ({ readonly kind: 'descent'; readonly at: Date } & DescentSegment);

/** Sampling resolution (points per curve). */
export interface CurveOpts {
  readonly points?: number;
}

/** One rung of the escalation ladder — the floor a challenger must clear after
 *  `step` successive displacements (`step: 0` is the starting floor). */
export interface LadderRung {
  readonly step: number;
  readonly price: Price;
}

const u64 = (v: unknown): bigint => BigInt(v as string | number | bigint);

/** A curve shape from the unrolled (String + Option) form the ensemble events carry
 *  (`<x>_shape_policy` + `<x>_alpha_*`) — the same form the reader decodes on-chain. */
function unrolledShape(kind: unknown, aNum: unknown, aDen: unknown, aAbs: unknown, aNeg: unknown): CurveShape {
  switch (kind) {
    case 'Linear':
      return { kind: 'linear' };
    case 'Smoothstep':
      return { kind: 'smoothstep' };
    case 'Logistic':
      return { kind: 'logistic' };
    case 'PowerLaw':
      return { kind: 'powerLaw', alphaNum: Number(aNum), alphaDen: Number(aDen) };
    case 'Exponential':
      return { kind: 'exponential', alphaAbs: Number(aAbs), alphaNeg: Boolean(aNeg) };
    default:
      throw new Error(`unknown curve shape ${JSON.stringify(kind)}`);
  }
}

/** Latest event of kind `kinds` at or before `atMs`. */
function governing(events: readonly HistoryEvent[], atMs: bigint, kinds: readonly string[], what: string): HistoryEvent {
  let best: HistoryEvent | undefined;
  for (const e of events) {
    if (!kinds.includes(e.kind)) continue;
    const ts = u64(e.data['timestamp_ms']);
    if (ts <= atMs && (best === undefined || ts >= u64(best.data['timestamp_ms']))) best = e;
  }
  if (!best) throw new Error(`no ${what} governs t=${atMs}`);
  return best;
}

/** Resolved cycle scalars (floor / ceiling / descent) in force at `atMs`. */
const governingCpr = (events: readonly HistoryEvent[], atMs: bigint): HistoryEvent =>
  governing(events, atMs, ['CycleParamsResolved'], 'CycleParamsResolved');

/** The ensemble in force at `atMs` — the credit/auction SHAPE source. Emitted at
 *  genesis (`PolicyEnsembleRegistered`) and on every change (`EnsembleUpdated`),
 *  paired with each `CycleParamsResolved` at the same site/timestamp. */
const governingEnsemble = (events: readonly HistoryEvent[], atMs: bigint): HistoryEvent =>
  governing(events, atMs, ['PolicyEnsembleRegistered', 'EnsembleUpdated'], 'ensemble event');

const creditShapeOf = (e: HistoryEvent): CurveShape =>
  unrolledShape(e.data['credit_shape_policy'], e.data['credit_alpha_num'], e.data['credit_alpha_den'], e.data['credit_alpha_abs'], e.data['credit_alpha_neg']);
const auctionShapeOf = (e: HistoryEvent): CurveShape =>
  unrolledShape(e.data['auction_shape_policy'], e.data['auction_alpha_num'], e.data['auction_alpha_den'], e.data['auction_alpha_abs'], e.data['auction_alpha_neg']);

/** `points + 1` sample times spanning [start, start + span]. */
function spanTimes(start: bigint, span: bigint, points: number): bigint[] {
  const out: bigint[] = [];
  for (let i = 0; i <= points; i++) out.push(start + (span * BigInt(i)) / BigInt(points));
  return out;
}

const toPoints = (start: bigint, ts: readonly bigint[], vals: readonly bigint[], coin: CoinInfo): CurvePoint[] =>
  ts.map((t, i) => ({ atMs: Number(t), offsetMs: Number(t - start), value: price(vals[i]!, coin) }));

/** Per-tenure credit curves, oldest first. A tenure begins at a `RentStarted`
 *  (fresh) or `HandoverCompleted` (promotion); its credit shape is the governing
 *  cycle's. */
export async function reconstructCreditHistory(
  events: readonly HistoryEvent[],
  client: ClientWithCoreApi,
  packageId: string,
  coin: CoinInfo,
  opts?: CurveOpts,
): Promise<CreditSegment[]> {
  const points = opts?.points ?? 24;
  const out: CreditSegment[] = [];
  for (const e of events) {
    let stake: bigint, phaseStart: bigint, ceiling: bigint, capId: string | null;
    if (e.kind === 'RentStarted') {
      stake = u64(e.data['price_paid']);
      phaseStart = u64(e.data['timestamp_ms']);
      ceiling = u64(e.data['ceiling_total_ms']);
      capId = (e.data['usufruct_cap_id'] as string | undefined) ?? null;
    } else if (e.kind === 'HandoverCompleted') {
      stake = u64(e.data['active_stake_balance']);
      phaseStart = u64(e.data['timestamp_ms']);
      ceiling = u64(e.data['ceiling_total_ms']);
      capId = (e.data['active_usufruct_cap_id'] as string | undefined) ?? null;
    } else {
      continue;
    }
    const shape = creditShapeOf(governingEnsemble(events, phaseStart));
    const ts = spanTimes(phaseStart, ceiling, points);
    const vals = await sampleCreditCurve(client, packageId, { stakeMist: stake, phaseStartMs: phaseStart, ceilingMs: ceiling, shape }, ts);
    out.push({
      capId,
      principal: price(stake, coin),
      shape,
      startedAt: new Date(Number(phaseStart)),
      ceilingMs: Number(ceiling),
      points: toPoints(phaseStart, ts, vals, coin),
    });
  }
  return out;
}

/** The full price line: discrete acquisition prices + descent curves, oldest first. */
export async function reconstructPriceTimeline(
  events: readonly HistoryEvent[],
  client: ClientWithCoreApi,
  packageId: string,
  coin: CoinInfo,
  opts?: CurveOpts,
): Promise<TimelineSegment[]> {
  const points = opts?.points ?? 24;
  const out: TimelineSegment[] = [];
  for (const e of events) {
    const at = e.at ?? new Date(Number(u64(e.data['timestamp_ms'])));
    if (e.kind === 'RentStarted') {
      out.push({ kind: 'rent', at, price: price(u64(e.data['price_paid']), coin), by: e.by });
    } else if (e.kind === 'BidPlaced') {
      out.push({ kind: 'bid', at, price: price(u64(e.data['pending_bid_amount']), coin), by: e.by });
    } else if (e.kind === 'BidSuperseded') {
      out.push({ kind: 'supersede', at, price: price(u64(e.data['pending_bid_amount']), coin), by: e.by });
    } else if (e.kind === 'HandoverCompleted') {
      out.push({ kind: 'handover', at, price: price(u64(e.data['new_rent_price']), coin), by: e.by });
    } else if (e.kind === 'TenureExpired') {
      const phaseStart = u64(e.data['timestamp_ms']);
      const cpr = governingCpr(events, phaseStart);
      const descentMs = u64(cpr.data['descent_ms']);
      if (descentMs === 0n) continue; // descent off: tenure expiry → idle, no curve
      const lastAcq = u64(e.data['last_acquisition_price']);
      const floor = u64(cpr.data['floor_mist']);
      const shape = auctionShapeOf(governingEnsemble(events, phaseStart));
      const ts = spanTimes(phaseStart, descentMs, points);
      const vals = await sampleDescentCurve(client, packageId, { lastAcqMist: lastAcq, phaseStartMs: phaseStart, floorMist: floor, descentMs, shape }, ts);
      out.push({
        kind: 'descent',
        at,
        shape,
        startedAt: new Date(Number(phaseStart)),
        descentMs: Number(descentMs),
        from: price(lastAcq, coin),
        to: price(floor, coin),
        points: toPoints(phaseStart, ts, vals, coin),
      });
    }
  }
  return out;
}
