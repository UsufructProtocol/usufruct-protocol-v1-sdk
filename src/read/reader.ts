/**
 * The thin wrapper — tier 1, the default read surface (SPEC §6.1).
 *
 * `createReader` binds a client + escrow target and exposes one typed async
 * method per on-chain view. Every answer is produced by the deployed
 * bytecode (`simulateTransaction`), so drift is zero by construction; and
 * because the views take `now_ms: u64` (not `&Clock`), the time-parameterised
 * methods read at any caller-supplied `t` — time-travel without a mirror.
 *
 * Methods delegate to the shared spec table (`./spec.ts`), which is also the
 * oracle the opt-in mirror is tested against. The return-type casts are the
 * single typed boundary; the decoders' correctness is golden-tested (§8).
 */
import type { ClientWithCoreApi } from '@mysten/sui/client';
import type { Bps, Id, Mist, Ms, TenureCount } from '../primitives/brand.js';
import type { AssetSchema, EscrowState } from '../primitives/state.js';
import { decodeEscrowState, uidAssetSchema } from '../primitives/state.js';
import type {
  AuctionWindow,
  Commitment,
  CurveShape,
  Handover,
  PriceEscalation,
  RestPrice,
  TenureDuration,
  TenureExtend,
} from '../types/config-types.js';
import type { CycleParamsView } from '../types/cycle-types.js';
import { SPEC_BY_NAME, VIEW_SPECS, runSpec, runSpecs, type ReadCtx } from './spec.js';

export interface ReaderTarget {
  readonly packageId: string;
  readonly escrowId: Id<'Escrow'>;
  readonly typeArguments: [string, string];
  /** Asset BCS schema for `fetch()`; defaults to uid-only (SPEC §10). */
  readonly assetSchema?: AssetSchema;
}

export interface HandoverSettlement {
  readonly remainingMist: Mist;
  readonly governorShareMist: Mist;
  readonly feeMist: Mist;
}
export interface TenureSettlement {
  readonly governorShareMist: Mist;
  readonly feeMist: Mist;
}

export interface SnapshotOpts {
  /** Include time-parameterised views, evaluated at this `t`. */
  readonly t?: Ms;
  /** Include cap-verification views, probed with this cap id. */
  readonly capId?: string;
}

export interface Reader {
  // status
  isIdle(): Promise<boolean>;
  isDescending(): Promise<boolean>;
  isOccupied(): Promise<boolean>;
  isDemand(): Promise<boolean>;
  isLive(): Promise<boolean>;
  isRetired(): Promise<boolean>;
  isRented(): Promise<boolean>;
  isRetiring(): Promise<boolean>;
  // identity
  assetId(): Promise<Id<'Asset'>>;
  governanceCapId(): Promise<Id<'GovernanceCap'>>;
  assetTypeName(): Promise<string>;
  coinTypeName(): Promise<string>;
  activeUsufructuaryAddr(): Promise<string | null>;
  activeUsufructCapId(): Promise<Id<'UsufructCap'> | null>;
  pendingUsufructuaryAddr(): Promise<string | null>;
  pendingUsufructCapId(): Promise<Id<'UsufructCap'> | null>;
  earningsInboxId(): Promise<Id<'EarningsInbox'>>;
  feeInboxId(): Promise<Id<'ProtocolFeeInbox'>>;
  // seat
  activeStakeBalanceMist(): Promise<Mist | null>;
  pendingStakeBalanceMist(): Promise<Mist | null>;
  activeCommittedTenures(): Promise<TenureCount | null>;
  pendingCommittedTenures(): Promise<TenureCount | null>;
  // cap verification
  governanceCapIsValid(capId: string): Promise<boolean>;
  usufructCapIsActive(capId: string): Promise<boolean>;
  usufructCapIsPending(capId: string): Promise<boolean>;
  usufructCapIsStale(capId: string): Promise<boolean>;
  // temporal
  phaseStartMs(): Promise<Ms | null>;
  tenureExpiryMs(): Promise<Ms | null>;
  transitionIsReady(t: Ms): Promise<boolean>;
  nextTransitionMs(t: Ms): Promise<Ms | null>;
  handoverExpiryMs(): Promise<Ms | null>;
  activeUsufructuaryTimeRemainingMs(t: Ms): Promise<Ms | null>;
  handoverExpiryIfBidAt(bidTimeMs: Ms): Promise<Ms | null>;
  tenureCeilingMs(): Promise<Ms>;
  integratedAtMs(): Promise<Ms>;
  // commitments
  retireCommitmentUnlocksAtMs(): Promise<Ms>;
  retireCommitmentAnchorMs(): Promise<Ms>;
  retireCommitmentRemainingMs(t: Ms): Promise<Ms>;
  ensembleCommitmentUnlocksAtMs(): Promise<Ms>;
  ensembleCommitmentAnchorMs(): Promise<Ms>;
  ensembleCommitmentRemainingMs(t: Ms): Promise<Ms>;
  // credit / auction memory
  lastRentPriceMist(): Promise<Mist | null>;
  creditIsAccruing(): Promise<boolean>;
  creditIsCapped(): Promise<boolean>;
  creditCappedAtMs(): Promise<Ms | null>;
  hasPendingEnsembleUpdate(): Promise<boolean>;
  // cycle params
  activeCycleParams(): Promise<CycleParamsView | null>;
  nextCycleParams(): Promise<CycleParamsView | null>;
  pendingCycleParams(): Promise<CycleParamsView | null>;
  activeCeilingTotalMs(): Promise<Ms | null>;
  activeHandoverTotalMs(): Promise<Ms | null>;
  // policy unions
  auctionWindow(): Promise<AuctionWindow>;
  handover(): Promise<Handover>;
  restPrice(): Promise<RestPrice>;
  tenureDuration(): Promise<TenureDuration>;
  tenureExtend(): Promise<TenureExtend>;
  priceEscalation(): Promise<PriceEscalation>;
  priceEscalationDeltaMist(): Promise<Mist>;
  retireCommitment(): Promise<Commitment>;
  ensembleCommitment(): Promise<Commitment>;
  creditShape(): Promise<CurveShape>;
  auctionShape(): Promise<CurveShape>;
  // constants
  protocolFeeBps(): Promise<Bps>;
  bpsDenominator(): Promise<Bps>;
  // settlement / curve math (Pattern A)
  floorPriceMist(t: Ms): Promise<Mist>;
  accruedCreditMist(t: Ms): Promise<Mist>;
  activeStakeBalanceRemainingMist(t: Ms): Promise<Mist | null>;
  nextFloorPriceMist(totalBidMist: Mist, tenures: TenureCount): Promise<Mist>;
  handoverSettlement(boundaryMs: Ms): Promise<HandoverSettlement>;
  tenureSettlement(): Promise<TenureSettlement>;
  // envelope + batch
  /** The structural envelope (ids, type args) — one getObject, no per-field call. */
  fetch(): Promise<EscrowState>;
  /**
   * Every nullary view in one (or few) simulation(s). Time-parameterised
   * views are included only when `t` is given; cap views only with `capId`.
   */
  snapshot(opts?: SnapshotOpts): Promise<Record<string, unknown>>;
}

export function createReader(client: ClientWithCoreApi, target: ReaderTarget): Reader {
  const base = (): ReadCtx => ({
    packageId: target.packageId,
    escrowId: target.escrowId,
    typeArguments: target.typeArguments,
  });
  const run = <T>(name: string, extra?: Partial<ReadCtx>): Promise<T> =>
    runSpec(client, SPEC_BY_NAME.get(name)!, { ...base(), ...extra }) as Promise<T>;
  const atT = <T>(name: string, t: Ms) => run<T>(name, { nowMs: t });
  const probe = <T>(name: string, capId: string) => run<T>(name, { probeCapId: capId });

  return {
    isIdle: () => run('isIdle'),
    isDescending: () => run('isDescending'),
    isOccupied: () => run('isOccupied'),
    isDemand: () => run('isDemand'),
    isLive: () => run('isLive'),
    isRetired: () => run('isRetired'),
    isRented: () => run('isRented'),
    isRetiring: () => run('isRetiring'),

    assetId: () => run('assetId'),
    governanceCapId: () => run('governanceCapId'),
    assetTypeName: () => run('assetTypeName'),
    coinTypeName: () => run('coinTypeName'),
    activeUsufructuaryAddr: () => run('activeUsufructuaryAddr'),
    activeUsufructCapId: () => run('activeUsufructCapId'),
    pendingUsufructuaryAddr: () => run('pendingUsufructuaryAddr'),
    pendingUsufructCapId: () => run('pendingUsufructCapId'),
    earningsInboxId: () => run('earningsInboxId'),
    feeInboxId: () => run('feeInboxId'),

    activeStakeBalanceMist: () => run('activeStakeBalanceMist'),
    pendingStakeBalanceMist: () => run('pendingStakeBalanceMist'),
    activeCommittedTenures: () => run('activeCommittedTenures'),
    pendingCommittedTenures: () => run('pendingCommittedTenures'),

    governanceCapIsValid: (capId) => probe('governanceCapIsValid', capId),
    usufructCapIsActive: (capId) => probe('usufructCapIsActive', capId),
    usufructCapIsPending: (capId) => probe('usufructCapIsPending', capId),
    usufructCapIsStale: (capId) => probe('usufructCapIsStale', capId),

    phaseStartMs: () => run('phaseStartMs'),
    tenureExpiryMs: () => run('tenureExpiryMs'),
    transitionIsReady: (t) => atT('transitionIsReady', t),
    nextTransitionMs: (t) => atT('nextTransitionMs', t),
    handoverExpiryMs: () => run('handoverExpiryMs'),
    activeUsufructuaryTimeRemainingMs: (t) => atT('activeUsufructuaryTimeRemainingMs', t),
    handoverExpiryIfBidAt: (bidTimeMs) => atT('handoverExpiryIfBidAt', bidTimeMs),
    tenureCeilingMs: () => run('tenureCeilingMs'),
    integratedAtMs: () => run('integratedAtMs'),

    retireCommitmentUnlocksAtMs: () => run('retireCommitmentUnlocksAtMs'),
    retireCommitmentAnchorMs: () => run('retireCommitmentAnchorMs'),
    retireCommitmentRemainingMs: (t) => atT('retireCommitmentRemainingMs', t),
    ensembleCommitmentUnlocksAtMs: () => run('ensembleCommitmentUnlocksAtMs'),
    ensembleCommitmentAnchorMs: () => run('ensembleCommitmentAnchorMs'),
    ensembleCommitmentRemainingMs: (t) => atT('ensembleCommitmentRemainingMs', t),

    lastRentPriceMist: () => run('lastRentPriceMist'),
    creditIsAccruing: () => run('creditIsAccruing'),
    creditIsCapped: () => run('creditIsCapped'),
    creditCappedAtMs: () => run('creditCappedAtMs'),
    hasPendingEnsembleUpdate: () => run('hasPendingEnsembleUpdate'),

    activeCycleParams: () => run('activeCycleParams'),
    nextCycleParams: () => run('nextCycleParams'),
    pendingCycleParams: () => run('pendingCycleParams'),
    activeCeilingTotalMs: () => run('activeCeilingTotalMs'),
    activeHandoverTotalMs: () => run('activeHandoverTotalMs'),

    auctionWindow: () => run('auctionWindow'),
    handover: () => run('handover'),
    restPrice: () => run('restPrice'),
    tenureDuration: () => run('tenureDuration'),
    tenureExtend: () => run('tenureExtend'),
    priceEscalation: () => run('priceEscalation'),
    priceEscalationDeltaMist: () => run('priceEscalationDeltaMist'),
    retireCommitment: () => run('retireCommitment'),
    ensembleCommitment: () => run('ensembleCommitment'),
    creditShape: () => run('creditShape'),
    auctionShape: () => run('auctionShape'),

    protocolFeeBps: () => run('protocolFeeBps'),
    bpsDenominator: () => run('bpsDenominator'),

    floorPriceMist: (t) => atT('floorPriceMist', t),
    accruedCreditMist: (t) => atT('accruedCreditMist', t),
    activeStakeBalanceRemainingMist: (t) => atT('activeStakeBalanceRemainingMist', t),
    nextFloorPriceMist: (totalBidMist, tenures) =>
      run('nextFloorPriceMist', { totalBidMist, tenures }),
    handoverSettlement: (boundaryMs) => run('handoverSettlement', { boundaryMs }),
    tenureSettlement: () => run('tenureSettlement'),

    fetch: async () => {
      const { object } = await client.core.getObject({
        objectId: target.escrowId,
        include: { content: true },
      });
      return decodeEscrowState(
        { objectId: object.objectId, type: object.type, content: object.content },
        target.assetSchema ?? uidAssetSchema,
      );
    },

    snapshot: (opts = {}) => {
      const provided = new Set<string>();
      if (opts.t != null) provided.add('now');
      if (opts.capId != null) provided.add('probe');
      const selected = VIEW_SPECS.filter((s) => (s.needs ?? []).every((n) => provided.has(n)));
      const ctx: ReadCtx = {
        ...base(),
        ...(opts.t != null ? { nowMs: opts.t } : {}),
        ...(opts.capId != null ? { probeCapId: opts.capId } : {}),
      };
      return runSpecs(client, selected, ctx).then((m) => Object.fromEntries(m));
    },
  };
}
