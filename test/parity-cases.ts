/**
 * Data-driven parity table: every mirrored view paired with the on-chain
 * Move view(s) that validate it. Consumed by the e2e harness (live
 * simulateTransaction) and by the golden replay test (recorded answers).
 *
 * A case's `decode` reconstructs the SDK-shaped value from the unrolled
 * Move views (the §5.1 collapse run in reverse), so both sides compare as
 * the same shape.
 */
import { bcs } from '@mysten/sui/bcs';
import type { Transaction, TransactionResult } from '@mysten/sui/transactions';
import * as ec from '../src/codegen/usufruct/escrow.js';
import type { Ms } from '../src/primitives/brand.js';
import type { AssetSchema, EscrowState } from '../src/primitives/state.js';
import * as views from '../src/views/index.js';

export interface ParityCtx {
  readonly packageId: string;
  readonly escrowId: string;
  readonly typeArguments: [string, string];
  readonly nowMs: bigint;
  /** Cap id used to probe the cap-verification views (the governance cap). */
  readonly probeCapId: string;
}

export interface ParityCase {
  readonly name: string;
  /** Each entry appends exactly one moveCall. */
  readonly calls: ReadonlyArray<(tx: Transaction, ctx: ParityCtx) => void>;
  /** Receives the first returnValue of each call, in order. */
  readonly decode: (rets: Uint8Array[], ctx: ParityCtx) => unknown;
  readonly local: (state: EscrowState<AssetSchema>, t: Ms, ctx: ParityCtx) => unknown;
}

/** Key-order-insensitive, bigint-safe canonical form for comparison. */
export function stable(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => {
    if (typeof v === 'bigint') return v.toString();
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      return Object.fromEntries(
        Object.entries(v as object).sort(([a], [b]) => a.localeCompare(b)),
      );
    }
    return v;
  });
}

const dBool = (b: Uint8Array) => bcs.bool().parse(b);
const dU64 = (b: Uint8Array) => bcs.u64().parse(b);
const dOptU64 = (b: Uint8Array) => bcs.option(bcs.u64()).parse(b);
const dAddr = (b: Uint8Array) => bcs.Address.parse(b);
const dOptAddr = (b: Uint8Array) => bcs.option(bcs.Address).parse(b);
const dStr = (b: Uint8Array) => bcs.string().parse(b);
const dOptU8 = (b: Uint8Array) => bcs.option(bcs.u8()).parse(b);
const dOptBool = (b: Uint8Array) => bcs.option(bcs.bool()).parse(b);

// Per-fun option types differ; the table treats wrappers uniformly.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Wrapper = (opts: any) => (tx: Transaction) => TransactionResult;

const call =
  (fn: Wrapper, args: (ctx: ParityCtx) => unknown[] = (ctx) => [ctx.escrowId]) =>
  (tx: Transaction, ctx: ParityCtx) =>
    void tx.add(
      fn({
        package: ctx.packageId,
        arguments: args(ctx),
        typeArguments: ctx.typeArguments,
      }),
    );

const withNow = (ctx: ParityCtx) => [ctx.escrowId, ctx.nowMs];
const withProbe = (ctx: ParityCtx) => [ctx.escrowId, ctx.probeCapId];

/** Single-call case. */
function one(
  name: string,
  fn: Wrapper,
  decode: (b: Uint8Array) => unknown,
  local: ParityCase['local'],
  args?: (ctx: ParityCtx) => unknown[],
): ParityCase {
  return { name, calls: [call(fn, args)], decode: (rets) => decode(rets[0]!), local };
}

const orNull = <T>(v: T | null | undefined): T | null => v ?? null;

function cycleRecord(rets: Uint8Array[]) {
  const [floor, ceiling, handover, descent] = rets.map(dOptU64);
  if (floor == null) return null;
  return {
    floorMist: floor,
    ceilingMs: ceiling,
    handoverMs: handover,
    descentMs: descent,
  };
}

function curveShapeFromUnrolled(rets: Uint8Array[]) {
  const kind = dStr(rets[0]!);
  switch (kind) {
    case 'Linear':
      return { kind: 'linear' };
    case 'Smoothstep':
      return { kind: 'smoothstep' };
    case 'Logistic':
      return { kind: 'logistic' };
    case 'PowerLaw':
      return { kind: 'powerLaw', alphaNum: dOptU8(rets[1]!), alphaDen: dOptU8(rets[2]!) };
    case 'Exponential':
      return {
        kind: 'exponential',
        alphaAbs: dOptU8(rets[3]!),
        alphaNeg: dOptBool(rets[4]!),
      };
    default:
      throw new Error(`unknown curve kind ${kind}`);
  }
}

export const PARITY_CASES: readonly ParityCase[] = [
  // ── status ──
  one('isIdle', ec.isIdle, dBool, views.isIdle),
  one('isDescending', ec.isDescending, dBool, views.isDescending),
  one('isOccupied', ec.isOccupied, dBool, views.isOccupied),
  one('isDemand', ec.isDemand, dBool, views.isDemand),
  one('isLive', ec.isLive, dBool, views.isLive),
  one('isRetired', ec.isRetired, dBool, views.isRetired),
  one('isRented', ec.isRented, dBool, views.isRented),
  one('isRetiring', ec.isRetiring, dBool, views.isRetiring),

  // ── identity ──
  one('assetId', ec.assetId, dAddr, views.assetId),
  one('governanceCapId', ec.governanceCapId, dAddr, views.governanceCapId),
  one('assetTypeName', ec.assetTypeName, dStr, views.assetTypeName),
  one('coinTypeName', ec.coinTypeName, dStr, views.coinTypeName),
  one('activeUsufructuaryAddr', ec.activeUsufructuaryAddr, dOptAddr, (s, t) =>
    views.activeUsufructuaryAddr(s, t),
  ),
  one('activeUsufructCapId', ec.activeUsufructCapId, dOptAddr, views.activeUsufructCapId),
  one('pendingUsufructuaryAddr', ec.pendingUsufructuaryAddr, dOptAddr, views.pendingUsufructuaryAddr),
  one('pendingUsufructCapId', ec.pendingUsufructCapId, dOptAddr, views.pendingUsufructCapId),
  one('earningsInboxId', ec.earningsInboxId, dAddr, views.earningsInboxId),
  one('feeInboxId', ec.feeInboxId, dAddr, views.feeInboxId),

  // ── seat ──
  one('activeStakeBalanceMist', ec.activeStakeBalanceMist, dOptU64, views.activeStakeBalanceMist),
  one('pendingStakeBalanceMist', ec.pendingStakeBalanceMist, dOptU64, views.pendingStakeBalanceMist),
  one(
    'activeCommittedTenures',
    ec.activeUsufructuaryCommittedTenures,
    dOptU64,
    views.activeCommittedTenures,
  ),
  one(
    'pendingCommittedTenures',
    ec.pendingUsufructuaryCommittedTenures,
    dOptU64,
    views.pendingCommittedTenures,
  ),

  // ── cap verification (probe = governance cap id) ──
  one(
    'governanceCapIsValid(probe)',
    ec.governanceCapIsValid,
    dBool,
    (s, t, ctx) => views.governanceCapIsValid(ctx.probeCapId)(s, t),
    withProbe,
  ),
  one(
    'usufructCapIsActive(probe)',
    ec.usufructCapIsActive,
    dBool,
    (s, t, ctx) => views.usufructCapIsActive(ctx.probeCapId)(s, t),
    withProbe,
  ),
  one(
    'usufructCapIsPending(probe)',
    ec.usufructCapIsPending,
    dBool,
    (s, t, ctx) => views.usufructCapIsPending(ctx.probeCapId)(s, t),
    withProbe,
  ),
  one(
    'usufructCapIsStale(probe)',
    ec.usufructCapIsStale,
    dBool,
    (s, t, ctx) => views.usufructCapIsStale(ctx.probeCapId)(s, t),
    withProbe,
  ),

  // ── temporal ──
  one('phaseStartMs', ec.phaseStartMs, dOptU64, views.phaseStartMs),
  one('tenureExpiryMs', ec.tenureExpiryMs, dOptU64, views.tenureExpiryMs),
  one('transitionIsReady', ec.transitionIsReady, dBool, views.transitionIsReady, withNow),
  one('nextTransitionMs', ec.nextTransitionMs, dOptU64, views.nextTransitionMs, withNow),
  one('handoverExpiryMs', ec.handoverExpiryMs, dOptU64, views.handoverExpiryMs),
  one(
    'activeUsufructuaryTimeRemainingMs',
    ec.activeUsufructuaryTimeRemainingMs,
    dOptU64,
    views.activeUsufructuaryTimeRemainingMs,
    withNow,
  ),
  one(
    'handoverExpiryIfBidAt(now)',
    ec.handoverExpiryIfBidAt,
    dOptU64,
    (s, t, ctx) => views.handoverExpiryIfBidAt(ctx.nowMs as Ms)(s, t),
    withNow,
  ),
  one('tenureCeilingMs', ec.tenureCeilingMs, dU64, views.tenureCeilingMs),
  one('integratedAtMs', ec.integratedAtMs, dU64, views.integratedAtMs),

  // ── commitments ──
  one('retireCommitmentUnlocksAtMs', ec.retireCommitmentUnlocksAtMs, dU64, views.retireCommitmentUnlocksAtMs),
  one('retireCommitmentAnchorMs', ec.retireCommitmentAnchorMs, dU64, views.retireCommitmentAnchorMs),
  one(
    'retireCommitmentRemainingMs',
    ec.retireCommitmentRemainingMs,
    dU64,
    views.retireCommitmentRemainingMs,
    withNow,
  ),
  one('ensembleCommitmentUnlocksAtMs', ec.ensembleCommitmentUnlocksAtMs, dU64, views.ensembleCommitmentUnlocksAtMs),
  one('ensembleCommitmentAnchorMs', ec.ensembleCommitmentAnchorMs, dU64, views.ensembleCommitmentAnchorMs),
  one(
    'ensembleCommitmentRemainingMs',
    ec.ensembleCommitmentRemainingMs,
    dU64,
    views.ensembleCommitmentRemainingMs,
    withNow,
  ),

  // ── credit / auction memory ──
  one('lastRentPriceMist', ec.lastRentPriceMist, dOptU64, views.lastRentPriceMist),
  one('creditIsAccruing', ec.creditIsAccruing, dBool, views.creditIsAccruing),
  one('creditIsCapped', ec.creditIsCapped, dBool, views.creditIsCapped),
  one('creditCappedAtMs', ec.creditCappedAtMs, dOptU64, views.creditCappedAtMs),
  one('hasPendingEnsembleUpdate', ec.hasPendingEnsembleUpdate, dBool, views.hasPendingEnsembleUpdate),

  // ── cycle params records (4 unrolled views each) ──
  {
    name: 'activeCycleParams',
    calls: [
      call(ec.activeEnsembleFloorPriceMist),
      call(ec.activeEnsembleCeilingMs),
      call(ec.activeEnsembleHandoverMs),
      call(ec.activeEnsembleDescentMs),
    ],
    decode: cycleRecord,
    local: views.activeCycleParams,
  },
  {
    name: 'nextCycleParams',
    calls: [
      call(ec.nextEnsembleFloorPriceMist),
      call(ec.nextEnsembleCeilingMs),
      call(ec.nextEnsembleHandoverMs),
      call(ec.nextEnsembleDescentMs),
    ],
    decode: cycleRecord,
    local: views.nextCycleParams,
  },
  {
    name: 'pendingCycleParams',
    calls: [
      call(ec.pendingEnsembleFloorPriceMist),
      call(ec.pendingEnsembleCeilingMs),
      call(ec.pendingEnsembleHandoverMs),
      call(ec.pendingEnsembleDescentMs),
    ],
    decode: cycleRecord,
    local: views.pendingCycleParams,
  },
  one('activeCeilingTotalMs', ec.activeCeilingTotalMs, dOptU64, views.activeCeilingTotalMs),
  one('activeHandoverTotalMs', ec.activeHandoverTotalMs, dOptU64, views.activeHandoverTotalMs),

  // ── policy unions (kind + per-variant fields reconstruct the union) ──
  {
    name: 'auctionWindow',
    calls: [call(ec.auctionWindowKind), call(ec.descentCeilingMs)],
    decode: (rets) =>
      dStr(rets[0]!) === 'Off' ? { kind: 'off' } : { kind: 'fixed', ceilingMs: dOptU64(rets[1]!) },
    local: views.auctionWindow,
  },
  {
    name: 'handover',
    calls: [call(ec.handoverKind), call(ec.handoverFloorMs)],
    decode: (rets) => {
      const kind = dStr(rets[0]!);
      if (kind === 'Off') return { kind: 'off' };
      if (kind === 'FullTenure') return { kind: 'fullTenure' };
      return { kind: 'fixed', floorMs: dOptU64(rets[1]!) };
    },
    local: views.handover,
  },
  {
    name: 'restPrice',
    calls: [call(ec.restPriceKind), call(ec.restPriceFloorMist)],
    decode: (rets) => ({ kind: dStr(rets[0]!).toLowerCase(), priceMist: dU64(rets[1]!) }),
    local: views.restPrice,
  },
  {
    name: 'tenureDuration',
    calls: [call(ec.tenureDurationKind), call(ec.tenureCeilingFixedMs)],
    decode: (rets) => ({ kind: dStr(rets[0]!).toLowerCase(), ceilingMs: dU64(rets[1]!) }),
    local: views.tenureDuration,
  },
  {
    name: 'tenureExtend',
    calls: [call(ec.tenureExtendKind)],
    decode: (rets) => ({ kind: dStr(rets[0]!).toLowerCase() }),
    local: views.tenureExtend,
  },
  {
    name: 'priceEscalation',
    calls: [
      call(ec.priceFnKind),
      call(ec.priceFnFixedDelta),
      call(ec.priceFnCompoundDeltaBps),
      call(ec.priceFnCompoundDeltaDelta),
    ],
    decode: (rets) =>
      dStr(rets[0]!) === 'FixedDelta'
        ? { kind: 'fixedDelta', deltaMist: dOptU64(rets[1]!) }
        : {
            kind: 'compoundDelta',
            bps: dOptU64(rets[2]!),
            deltaMist: dOptU64(rets[3]!),
          },
    local: views.priceEscalation,
  },
  one('priceEscalationDeltaMist', ec.priceFnDeltaMist, dU64, views.priceEscalationDeltaMist),
  {
    name: 'retireCommitment',
    calls: [call(ec.retireCommitmentKind), call(ec.retireCommitmentFloorMs)],
    decode: (rets) =>
      dStr(rets[0]!) === 'Immediate'
        ? { kind: 'immediate' }
        : { kind: 'deferred', floorMs: dOptU64(rets[1]!) },
    local: views.retireCommitment,
  },
  {
    name: 'ensembleCommitment',
    calls: [call(ec.ensembleCommitmentKind), call(ec.ensembleCommitmentFloorMs)],
    decode: (rets) =>
      dStr(rets[0]!) === 'Immediate'
        ? { kind: 'immediate' }
        : { kind: 'deferred', floorMs: dOptU64(rets[1]!) },
    local: views.ensembleCommitment,
  },
  {
    name: 'creditShape',
    calls: [
      call(ec.creditShapeKind),
      call(ec.creditShapePowerLawAlphaNum),
      call(ec.creditShapePowerLawAlphaDen),
      call(ec.creditShapeExponentialAlphaAbs),
      call(ec.creditShapeExponentialAlphaNeg),
    ],
    decode: curveShapeFromUnrolled,
    local: views.creditShape,
  },
  {
    name: 'auctionShape',
    calls: [
      call(ec.auctionShapeKind),
      call(ec.auctionShapePowerLawAlphaNum),
      call(ec.auctionShapePowerLawAlphaDen),
      call(ec.auctionShapeExponentialAlphaAbs),
      call(ec.auctionShapeExponentialAlphaNeg),
    ],
    decode: curveShapeFromUnrolled,
    local: views.auctionShape,
  },

  // ── constants (module-level, no escrow argument, not generic) ──
  {
    name: 'protocolFeeBps',
    calls: [(tx, ctx) => void tx.add(ec.protocolFeeBps({ package: ctx.packageId }))],
    decode: (rets) => dU64(rets[0]!),
    local: () => views.PROTOCOL_FEE_BPS,
  },
  {
    name: 'bpsDenominator',
    calls: [(tx, ctx) => void tx.add(ec.bpsDenominator({ package: ctx.packageId }))],
    decode: (rets) => dU64(rets[0]!),
    local: () => views.BPS_DENOMINATOR,
  },
];

/**
 * Normalized comparison: both sides reduce to the canonical `stable` string.
 * `null`/`undefined` collapse to null; option-u64 strings and bigints agree.
 */
export function parityEqual(local: unknown, onchain: unknown): boolean {
  return stable(orNull(local)) === stable(orNull(onchain));
}
