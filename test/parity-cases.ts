/**
 * Parity oracle: pairs each on-chain view spec (src/read/spec.ts — the
 * wrapper's own decode logic) with the opt-in mirror (sim.views) that claims
 * to reproduce it. The on-chain side IS the product; this file is the test
 * that keeps the mirror honest (SPEC §8). One table, two consumers.
 */
import type { Ms } from '@usufruct-protocol/sdk/primitives/brand.js';
import type { AssetSchema } from '@usufruct-protocol/sdk/primitives/state.js';
import type { EscrowState } from '@usufruct-protocol/sim/primitives/state.js';
import { VIEW_SPECS, type ReadCtx, type ViewSpec } from '@usufruct-protocol/sdk/read/spec.js';
import * as views from '@usufruct-protocol/sim/views/index.js';

export { stable, parityEqual } from '@usufruct-protocol/sdk/read/spec.js';
export type { ReadCtx as ParityCtx } from '@usufruct-protocol/sdk/read/spec.js';

type LocalFn = (state: EscrowState<AssetSchema>, t: Ms, ctx: ReadCtx) => unknown;

/**
 * The mirror side, keyed by spec name. Only views that HAVE a mirror appear;
 * pure-on-chain reads (e.g. settlement Inspect) have no entry and are simply
 * not parity-checked — there is nothing to keep honest.
 */
const LOCAL: Record<string, LocalFn> = {
  isIdle: views.isIdle,
  isDescending: views.isDescending,
  isOccupied: views.isOccupied,
  isDemand: views.isDemand,
  isLive: views.isLive,
  isRetired: views.isRetired,
  isRented: views.isRented,
  isRetiring: views.isRetiring,

  assetId: views.assetId,
  governanceCapId: views.governanceCapId,
  assetTypeName: views.assetTypeName,
  coinTypeName: views.coinTypeName,
  activeUsufructuaryAddr: views.activeUsufructuaryAddr,
  activeUsufructCapId: views.activeUsufructCapId,
  pendingUsufructuaryAddr: views.pendingUsufructuaryAddr,
  pendingUsufructCapId: views.pendingUsufructCapId,
  earningsInboxId: views.earningsInboxId,
  feeInboxId: views.feeInboxId,

  activeStakeBalanceMist: views.activeStakeBalanceMist,
  pendingStakeBalanceMist: views.pendingStakeBalanceMist,
  activeCommittedTenures: views.activeCommittedTenures,
  pendingCommittedTenures: views.pendingCommittedTenures,

  governanceCapIsValid: (s, t, ctx) => views.governanceCapIsValid(ctx.probeCapId!)(s, t),
  usufructCapIsActive: (s, t, ctx) => views.usufructCapIsActive(ctx.probeCapId!)(s, t),
  usufructCapIsPending: (s, t, ctx) => views.usufructCapIsPending(ctx.probeCapId!)(s, t),
  usufructCapIsStale: (s, t, ctx) => views.usufructCapIsStale(ctx.probeCapId!)(s, t),

  phaseStartMs: views.phaseStartMs,
  tenureExpiryMs: views.tenureExpiryMs,
  transitionIsReady: views.transitionIsReady,
  nextTransitionMs: views.nextTransitionMs,
  handoverExpiryMs: views.handoverExpiryMs,
  activeUsufructuaryTimeRemainingMs: views.activeUsufructuaryTimeRemainingMs,
  handoverExpiryIfBidAt: (s, t, ctx) => views.handoverExpiryIfBidAt(ctx.nowMs! as Ms)(s, t),
  tenureCeilingMs: views.tenureCeilingMs,
  integratedAtMs: views.integratedAtMs,

  retireCommitmentUnlocksAtMs: views.retireCommitmentUnlocksAtMs,
  retireCommitmentAnchorMs: views.retireCommitmentAnchorMs,
  retireCommitmentRemainingMs: views.retireCommitmentRemainingMs,
  ensembleCommitmentUnlocksAtMs: views.ensembleCommitmentUnlocksAtMs,
  ensembleCommitmentAnchorMs: views.ensembleCommitmentAnchorMs,
  ensembleCommitmentRemainingMs: views.ensembleCommitmentRemainingMs,

  lastRentPriceMist: views.lastRentPriceMist,
  creditIsAccruing: views.creditIsAccruing,
  creditIsCapped: views.creditIsCapped,
  creditCappedAtMs: views.creditCappedAtMs,
  hasPendingEnsembleUpdate: views.hasPendingEnsembleUpdate,

  cycleParams: views.cycleParams,
  pendingCycleParams: views.pendingCycleParams,
  activeCeilingTotalMs: views.activeCeilingTotalMs,
  activeHandoverTotalMs: views.activeHandoverTotalMs,

  auctionWindow: views.auctionWindow,
  handover: views.handover,
  restPrice: views.restPrice,
  tenureDuration: views.tenureDuration,
  tenureExtend: views.tenureExtend,
  priceEscalation: views.priceEscalation,
  priceEscalationDeltaMist: views.priceEscalationDeltaMist,
  retireCommitment: views.retireCommitment,
  ensembleCommitment: views.ensembleCommitment,
  creditShape: views.creditShape,
  auctionShape: views.auctionShape,

  protocolFeeBps: () => views.PROTOCOL_FEE_BPS,
  bpsDenominator: () => views.BPS_DENOMINATOR,
};

export interface ParityCase {
  readonly name: string;
  readonly spec: ViewSpec;
  readonly local: LocalFn;
}

/** Every spec that has a mirror, paired for comparison. */
export const PARITY_CASES: readonly ParityCase[] = VIEW_SPECS.filter(
  (s) => LOCAL[s.name] !== undefined,
).map((spec) => ({ name: spec.name, spec, local: LOCAL[spec.name]! }));
