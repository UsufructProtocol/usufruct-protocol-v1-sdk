/**
 * View-spec table — the single source of the on-chain read logic (SPEC §6.1).
 *
 * Each entry pairs a view's `escrow.move` call(s) with a BCS decoder that
 * rebuilds the SDK-shaped value (the §5.1 collapse run in reverse). The
 * thin-wrapper `Reader` (src/read/reader.ts) runs these against the deployed
 * bytecode; the golden/parity tests import the SAME table as the oracle the
 * opt-in mirror is checked against. Wrapper and oracle are one piece of code.
 */
import { bcs } from '@mysten/sui/bcs';
import type { ClientWithCoreApi } from '@mysten/sui/client';
import { Transaction, type TransactionResult } from '@mysten/sui/transactions';
import { normalizeSuiAddress } from '@mysten/sui/utils';
import * as ec from '../codegen/usufruct/escrow.js';

/** Arguments a view may require beyond the fixed target. */
export type ReadArg = 'now' | 'probe' | 'boundary' | 'nextFloor' | 'rented';

/** Fixed target + the optional per-call arguments some views require. */
export interface ReadCtx {
  readonly packageId: string;
  readonly escrowId: string;
  readonly typeArguments: [string, string];
  /** Explicit time for time-parameterised views (`now_ms: u64`). */
  readonly nowMs?: bigint;
  /** Cap id for the cap-verification views. */
  readonly probeCapId?: string;
  /** Boundary timestamp for settlement views. */
  readonly boundaryMs?: bigint;
  /** Hypothetical total bid for `next_floor_price_mist`. */
  readonly totalBidMist?: bigint;
  /** Hypothetical tenure count for `next_floor_price_mist`. */
  readonly tenures?: bigint;
}

export interface ViewSpec {
  readonly name: string;
  /** Each thunk appends exactly one moveCall. */
  readonly calls: ReadonlyArray<(tx: Transaction, ctx: ReadCtx) => void>;
  /** Receives every returnValue of every call, flattened in order. */
  readonly decode: (rets: Uint8Array[], ctx: ReadCtx) => unknown;
  /** Args this view needs; a snapshot includes it only if all are supplied. */
  readonly needs?: readonly ReadArg[];
}

// ── decoders (u64 → bigint, matching the branded SDK types) ──
const dBool = (b: Uint8Array) => bcs.bool().parse(b);
const dU64 = (b: Uint8Array) => BigInt(bcs.u64().parse(b));
const dOptU64 = (b: Uint8Array) => {
  const v = bcs.option(bcs.u64()).parse(b);
  return v == null ? null : BigInt(v);
};
const dAddr = (b: Uint8Array) => bcs.Address.parse(b);
const dOptAddr = (b: Uint8Array) => bcs.option(bcs.Address).parse(b);
const dStr = (b: Uint8Array) => bcs.string().parse(b);
const dOptU8 = (b: Uint8Array) => bcs.option(bcs.u8()).parse(b);
const dOptBool = (b: Uint8Array) => bcs.option(bcs.bool()).parse(b);

// Per-fun option types differ; the table treats wrappers uniformly.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Wrapper = (opts: any) => (tx: Transaction) => TransactionResult;

const call =
  (fn: Wrapper, args: (ctx: ReadCtx) => unknown[] = (ctx) => [ctx.escrowId]) =>
  (tx: Transaction, ctx: ReadCtx) =>
    void tx.add(
      fn({ package: ctx.packageId, arguments: args(ctx), typeArguments: ctx.typeArguments }),
    );

const withNow = (ctx: ReadCtx) => [ctx.escrowId, ctx.nowMs];
const withProbe = (ctx: ReadCtx) => [ctx.escrowId, ctx.probeCapId];

function one(
  name: string,
  fn: Wrapper,
  decode: (b: Uint8Array) => unknown,
  args?: (ctx: ReadCtx) => unknown[],
  needs?: readonly ReadArg[],
): ViewSpec {
  return {
    name,
    calls: [call(fn, args)],
    decode: (rets) => decode(rets[0]!),
    ...(needs ? { needs } : {}),
  };
}

const NOW: readonly ReadArg[] = ['now'];
const PROBE: readonly ReadArg[] = ['probe'];

function cycleRecord(rets: Uint8Array[]) {
  const [floor, ceiling, handover, descent] = rets.map(dOptU64);
  if (floor == null) return null;
  return { floorMist: floor, ceilingMs: ceiling, handoverMs: handover, descentMs: descent };
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
      return { kind: 'exponential', alphaAbs: dOptU8(rets[3]!), alphaNeg: dOptBool(rets[4]!) };
    default:
      throw new Error(`unknown curve kind ${kind}`);
  }
}

export const VIEW_SPECS: readonly ViewSpec[] = [
  // ── status ──
  one('isIdle', ec.isIdle, dBool),
  one('isDescending', ec.isDescending, dBool),
  one('isOccupied', ec.isOccupied, dBool),
  one('isDemand', ec.isDemand, dBool),
  one('isLive', ec.isLive, dBool),
  one('isRetired', ec.isRetired, dBool),
  one('isRented', ec.isRented, dBool),
  one('isRetiring', ec.isRetiring, dBool),

  // ── identity ──
  one('assetId', ec.assetId, dAddr),
  one('governanceCapId', ec.governanceCapId, dAddr),
  one('assetTypeName', ec.assetTypeName, dStr),
  one('coinTypeName', ec.coinTypeName, dStr),
  one('activeUsufructuaryAddr', ec.activeUsufructuaryAddr, dOptAddr),
  one('activeUsufructCapId', ec.activeUsufructCapId, dOptAddr),
  one('pendingUsufructuaryAddr', ec.pendingUsufructuaryAddr, dOptAddr),
  one('pendingUsufructCapId', ec.pendingUsufructCapId, dOptAddr),
  one('earningsInboxId', ec.earningsInboxId, dAddr),
  one('feeInboxId', ec.feeInboxId, dAddr),

  // ── seat ──
  one('activeStakeBalanceMist', ec.activeStakeBalanceMist, dOptU64),
  one('pendingStakeBalanceMist', ec.pendingStakeBalanceMist, dOptU64),
  one('activeCommittedTenures', ec.activeUsufructuaryCommittedTenures, dOptU64),
  one('pendingCommittedTenures', ec.pendingUsufructuaryCommittedTenures, dOptU64),

  // ── cap verification (probe cap id) ──
  one('governanceCapIsValid', ec.governanceCapIsValid, dBool, withProbe, PROBE),
  one('usufructCapIsActive', ec.usufructCapIsActive, dBool, withProbe, PROBE),
  one('usufructCapIsPending', ec.usufructCapIsPending, dBool, withProbe, PROBE),
  one('usufructCapIsStale', ec.usufructCapIsStale, dBool, withProbe, PROBE),

  // ── temporal ──
  one('phaseStartMs', ec.phaseStartMs, dOptU64),
  one('tenureExpiryMs', ec.tenureExpiryMs, dOptU64),
  one('transitionIsReady', ec.transitionIsReady, dBool, withNow, NOW),
  one('nextTransitionMs', ec.nextTransitionMs, dOptU64, withNow, NOW),
  one('handoverExpiryMs', ec.handoverExpiryMs, dOptU64),
  one('activeUsufructuaryTimeRemainingMs', ec.activeUsufructuaryTimeRemainingMs, dOptU64, withNow, NOW),
  one('handoverExpiryIfBidAt', ec.handoverExpiryIfBidAt, dOptU64, withNow, NOW),
  one('tenureCeilingMs', ec.tenureCeilingMs, dU64),
  one('integratedAtMs', ec.integratedAtMs, dU64),

  // ── commitments ──
  one('retireCommitmentUnlocksAtMs', ec.retireCommitmentUnlocksAtMs, dU64),
  one('retireCommitmentAnchorMs', ec.retireCommitmentAnchorMs, dU64),
  one('retireCommitmentRemainingMs', ec.retireCommitmentRemainingMs, dU64, withNow, NOW),
  one('ensembleCommitmentUnlocksAtMs', ec.ensembleCommitmentUnlocksAtMs, dU64),
  one('ensembleCommitmentAnchorMs', ec.ensembleCommitmentAnchorMs, dU64),
  one('ensembleCommitmentRemainingMs', ec.ensembleCommitmentRemainingMs, dU64, withNow, NOW),

  // ── credit / auction memory ──
  one('lastRentPriceMist', ec.lastRentPriceMist, dOptU64),
  one('creditIsAccruing', ec.creditIsAccruing, dBool),
  one('creditIsCapped', ec.creditIsCapped, dBool),
  one('creditCappedAtMs', ec.creditCappedAtMs, dOptU64),
  one('hasPendingEnsembleUpdate', ec.hasPendingEnsembleUpdate, dBool),

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
  },
  one('activeCeilingTotalMs', ec.activeCeilingTotalMs, dOptU64),
  one('activeHandoverTotalMs', ec.activeHandoverTotalMs, dOptU64),

  // ── policy unions (kind + per-variant fields reconstruct the union) ──
  {
    name: 'auctionWindow',
    calls: [call(ec.auctionWindowKind), call(ec.descentCeilingMs)],
    decode: (rets) =>
      dStr(rets[0]!) === 'Off' ? { kind: 'off' } : { kind: 'fixed', ceilingMs: dOptU64(rets[1]!) },
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
  },
  {
    name: 'restPrice',
    calls: [call(ec.restPriceKind), call(ec.restPriceFloorMist)],
    decode: (rets) => ({ kind: dStr(rets[0]!).toLowerCase(), priceMist: dU64(rets[1]!) }),
  },
  {
    name: 'tenureDuration',
    calls: [call(ec.tenureDurationKind), call(ec.tenureCeilingFixedMs)],
    decode: (rets) => ({ kind: dStr(rets[0]!).toLowerCase(), ceilingMs: dU64(rets[1]!) }),
  },
  {
    name: 'tenureExtend',
    calls: [call(ec.tenureExtendKind)],
    decode: (rets) => ({ kind: dStr(rets[0]!).toLowerCase() }),
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
        : { kind: 'compoundDelta', bps: dOptU64(rets[2]!), deltaMist: dOptU64(rets[3]!) },
  },
  one('priceEscalationDeltaMist', ec.priceFnDeltaMist, dU64),
  {
    name: 'retireCommitment',
    calls: [call(ec.retireCommitmentKind), call(ec.retireCommitmentFloorMs)],
    decode: (rets) =>
      dStr(rets[0]!) === 'Immediate'
        ? { kind: 'immediate' }
        : { kind: 'deferred', floorMs: dOptU64(rets[1]!) },
  },
  {
    name: 'ensembleCommitment',
    calls: [call(ec.ensembleCommitmentKind), call(ec.ensembleCommitmentFloorMs)],
    decode: (rets) =>
      dStr(rets[0]!) === 'Immediate'
        ? { kind: 'immediate' }
        : { kind: 'deferred', floorMs: dOptU64(rets[1]!) },
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
  },

  // ── settlement / curve math (Pattern A; pure on-chain, no mirror) ──
  one('floorPriceMist', ec.floorPriceMist, dU64, withNow, NOW),
  one('accruedCreditMist', ec.accruedCreditMist, dU64, withNow, NOW),
  one(
    'activeStakeBalanceRemainingMist',
    ec.activeStakeBalanceRemainingMist,
    dOptU64,
    withNow,
    NOW,
  ),
  {
    name: 'nextFloorPriceMist',
    calls: [call(ec.nextFloorPriceMist, (ctx) => [ctx.escrowId, ctx.totalBidMist, ctx.tenures])],
    decode: (rets) => dU64(rets[0]!),
    needs: ['nextFloor'],
  },
  {
    name: 'handoverSettlement',
    calls: [call(ec.handoverSettlement, (ctx) => [ctx.escrowId, ctx.boundaryMs])],
    decode: (rets) => ({
      remainingMist: dU64(rets[0]!),
      governorShareMist: dU64(rets[1]!),
      feeMist: dU64(rets[2]!),
    }),
    needs: ['boundary'],
  },
  {
    // Aborts on a non-rented escrow (protocol abort surfaces verbatim);
    // `rented` is never satisfied by snapshot, so it is method-only.
    name: 'tenureSettlement',
    calls: [call(ec.tenureSettlement)],
    decode: (rets) => ({ governorShareMist: dU64(rets[0]!), feeMist: dU64(rets[1]!) }),
    needs: ['rented'],
  },

  // ── constants (module-level, no escrow argument, not generic) ──
  {
    name: 'protocolFeeBps',
    calls: [(tx, ctx) => void tx.add(ec.protocolFeeBps({ package: ctx.packageId }))],
    decode: (rets) => dU64(rets[0]!),
  },
  {
    name: 'bpsDenominator',
    calls: [(tx, ctx) => void tx.add(ec.bpsDenominator({ package: ctx.packageId }))],
    decode: (rets) => dU64(rets[0]!),
  },
];

/** Spec lookup by name (reader methods reference specs by name). */
export const SPEC_BY_NAME: ReadonlyMap<string, ViewSpec> = new Map(
  VIEW_SPECS.map((s) => [s.name, s]),
);

const ZERO_SENDER = normalizeSuiAddress('0x0');

function flattenReturns(
  commandResults: ReadonlyArray<{ returnValues: ReadonlyArray<{ bcs: Uint8Array }> }>,
  start: number,
  callCount: number,
): { rets: Uint8Array[]; next: number } {
  const rets: Uint8Array[] = [];
  let cmd = start;
  for (let k = 0; k < callCount; k++) {
    for (const rv of commandResults[cmd]!.returnValues) rets.push(rv.bcs);
    cmd++;
  }
  return { rets, next: cmd };
}

/**
 * Run one view spec against the deployed bytecode. Reads need no real signer
 * but simulation requires a sender to build. Protocol aborts surface verbatim.
 */
export async function runSpec(
  client: ClientWithCoreApi,
  spec: ViewSpec,
  ctx: ReadCtx,
): Promise<unknown> {
  const tx = new Transaction();
  tx.setSenderIfNotSet(ZERO_SENDER);
  for (const c of spec.calls) c(tx, ctx);
  const sim = await client.core.simulateTransaction({
    transaction: tx,
    checksEnabled: false,
    include: { commandResults: true },
  });
  if (sim.$kind !== 'Transaction') {
    throw new Error(
      `read(${spec.name}) failed: ${sim.FailedTransaction?.status.error?.message ?? 'unknown'}`,
    );
  }
  const { rets } = flattenReturns(sim.commandResults ?? [], 0, spec.calls.length);
  return spec.decode(rets, ctx);
}

/**
 * Run many specs, batching their calls into `chunk`-sized simulations (a
 * spec never straddles a batch). Returns decoded values keyed by spec name.
 */
export async function runSpecs(
  client: ClientWithCoreApi,
  specs: readonly ViewSpec[],
  ctx: ReadCtx,
  chunk = 40,
): Promise<Map<string, unknown>> {
  const out = new Map<string, unknown>();
  let i = 0;
  while (i < specs.length) {
    const batch: ViewSpec[] = [];
    let calls = 0;
    while (i < specs.length && (batch.length === 0 || calls + specs[i]!.calls.length <= chunk)) {
      batch.push(specs[i]!);
      calls += specs[i]!.calls.length;
      i++;
    }
    const tx = new Transaction();
    tx.setSenderIfNotSet(ZERO_SENDER);
    for (const s of batch) for (const c of s.calls) c(tx, ctx);
    const sim = await client.core.simulateTransaction({
      transaction: tx,
      checksEnabled: false,
      include: { commandResults: true },
    });
    if (sim.$kind !== 'Transaction') {
      throw new Error(
        `read batch failed: ${sim.FailedTransaction?.status.error?.message ?? 'unknown'}`,
      );
    }
    const crs = sim.commandResults ?? [];
    let cmd = 0;
    for (const s of batch) {
      const { rets, next } = flattenReturns(crs, cmd, s.calls.length);
      cmd = next;
      out.set(s.name, s.decode(rets, ctx));
    }
  }
  return out;
}

/**
 * Cross-escrow batch: each job is one escrow's `ctx` plus the specs to read for
 * it. All jobs' calls are interleaved into `chunk`-sized simulations (a spec
 * never straddles a batch), then demuxed back per job — `spec.decode(rets, ctx)`
 * runs with *that job's* ctx. Returns `jobIndex → (specName → decoded)`.
 *
 * Caller's contract (as for `runSpecs`): only include specs valid in each
 * escrow's current state — an aborting view fails the whole simulation.
 */
export async function runSpecsMulti(
  client: ClientWithCoreApi,
  jobs: ReadonlyArray<{ ctx: ReadCtx; specs: readonly ViewSpec[] }>,
  chunk = 40,
): Promise<Map<number, Map<string, unknown>>> {
  // Flatten to a stream of (jobIndex, spec, ctx), preserving order.
  const units: Array<{ job: number; spec: ViewSpec; ctx: ReadCtx }> = [];
  jobs.forEach((j, job) => j.specs.forEach((spec) => units.push({ job, spec, ctx: j.ctx })));

  const out = new Map<number, Map<string, unknown>>();
  jobs.forEach((_, job) => out.set(job, new Map()));

  let i = 0;
  while (i < units.length) {
    const batch: typeof units = [];
    let calls = 0;
    while (i < units.length && (batch.length === 0 || calls + units[i]!.spec.calls.length <= chunk)) {
      batch.push(units[i]!);
      calls += units[i]!.spec.calls.length;
      i++;
    }
    const tx = new Transaction();
    tx.setSenderIfNotSet(ZERO_SENDER);
    for (const u of batch) for (const c of u.spec.calls) c(tx, u.ctx);
    const sim = await client.core.simulateTransaction({
      transaction: tx,
      checksEnabled: false,
      include: { commandResults: true },
    });
    if (sim.$kind !== 'Transaction') {
      throw new Error(
        `read multi-batch failed: ${sim.FailedTransaction?.status.error?.message ?? 'unknown'}`,
      );
    }
    const crs = sim.commandResults ?? [];
    let cmd = 0;
    for (const u of batch) {
      const { rets, next } = flattenReturns(crs, cmd, u.spec.calls.length);
      cmd = next;
      out.get(u.job)!.set(u.spec.name, u.spec.decode(rets, u.ctx));
    }
  }
  return out;
}

// ── comparison helpers (shared with the parity/golden oracle) ──

/** Key-order-insensitive, bigint-safe canonical form. */
export function stable(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => {
    if (typeof v === 'bigint') return v.toString();
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      return Object.fromEntries(Object.entries(v as object).sort(([a], [b]) => a.localeCompare(b)));
    }
    return v;
  });
}

const orNull = <T>(v: T | null | undefined): T | null => v ?? null;

export function parityEqual(local: unknown, onchain: unknown): boolean {
  return stable(orNull(local)) === stable(orNull(onchain));
}
