/**
 * Config views — the §5.1 enum collapse. One discriminated union per policy
 * family replaces its unrolled `*_is_X` / `*_field` / `*_kind` Move views
 * (broad collapse, user decision 2026-06-12). The unrolled on-chain views
 * remain the parity oracle in the e2e harness.
 */
import type { Bps, Mist } from '@usufruct-protocol/sdk/primitives/brand.js';
import { bps, mist, ms } from '@usufruct-protocol/sdk/primitives/brand.js';
import type { View } from '../primitives/view.js';
import type {
  AuctionWindow,
  Commitment,
  CurveShape,
  Handover,
  PriceEscalation,
  RestPrice,
  TenureDuration,
  TenureExtend,
} from '@usufruct-protocol/sdk/types/config-types.js';
import { core, ensemble } from './internal.js';

// The policy unions now live in core (`types/config-types.ts`) so the on-chain
// Reader can type its returns without importing the mirror. This module keeps
// the runtime `collapse*` projections and re-exports the types for back-compat.
export type {
  AuctionWindow,
  Commitment,
  CurveShape,
  Handover,
  PriceEscalation,
  RestPrice,
  TenureDuration,
  TenureExtend,
};

/** `escrow::protocol_fee_bps()` — 10% of consumed credit. */
export const PROTOCOL_FEE_BPS: Bps = bps(1_000);
/** `escrow::bps_denominator()`. */
export const BPS_DENOMINATOR: Bps = bps(10_000);

type CurveShapePolicyData = ReturnType<typeof ensemble>['credit_shape'];

export function collapseCurveShape(policy: CurveShapePolicyData): CurveShape {
  switch (policy.$kind) {
    case 'Linear':
      return { kind: 'linear' };
    case 'Smoothstep':
      return { kind: 'smoothstep' };
    case 'Logistic':
      return { kind: 'logistic' };
    case 'PowerLaw':
      return {
        kind: 'powerLaw',
        alphaNum: policy.PowerLaw.alpha_num,
        alphaDen: policy.PowerLaw.alpha_den,
      };
    case 'Exponential':
      return {
        kind: 'exponential',
        alphaAbs: policy.Exponential.alpha_abs,
        alphaNeg: policy.Exponential.alpha_neg,
      };
  }
}

export const creditShape: View<CurveShape> = (state) =>
  collapseCurveShape(ensemble(state).credit_shape);

export const auctionShape: View<CurveShape> = (state) =>
  collapseCurveShape(ensemble(state).auction_shape);

// ── Policy unions ──
// Each collapses one Move family: the `*_is_X` predicates, the `*_kind`
// string view, and the per-variant field accessors.

/** Collapses `auction_window_is_off/_is_fixed`, `auction_window_kind`, `descent_ceiling_ms`. */
export const auctionWindow: View<AuctionWindow> = (state) => {
  const p = ensemble(state).auction_window;
  return p.$kind === 'Off'
    ? { kind: 'off' }
    : { kind: 'fixed', ceilingMs: ms(p.Fixed.ceiling.ms) };
};

/** Collapses `handover_is_*`, `handover_kind`, `handover_floor_ms`. */
export const handover: View<Handover> = (state) => {
  const p = ensemble(state).handover;
  switch (p.$kind) {
    case 'Off':
      return { kind: 'off' };
    case 'FullTenure':
      return { kind: 'fullTenure' };
    case 'Fixed':
      return { kind: 'fixed', floorMs: ms(p.Fixed.floor.ms) };
  }
};

/** Collapses `rest_price_kind`, `rest_price_floor_mist`, `rest_price_floor_fixed_mist`. */
export const restPrice: View<RestPrice> = (state) => {
  const p = ensemble(state).rest_price;
  return { kind: 'fixed', priceMist: mist(p.Fixed.price.mist) };
};

/** Collapses `tenure_duration_kind/_is_fixed`, `tenure_ceiling_ms`, `tenure_ceiling_fixed_ms`. */
export const tenureDuration: View<TenureDuration> = (state) => {
  const p = ensemble(state).tenure_duration;
  return { kind: 'fixed', ceilingMs: ms(p.Fixed.ceiling.ms) };
};

/** Collapses `tenure_extend_kind`. */
export const tenureExtend: View<TenureExtend> = (state) =>
  ensemble(state).tenure_extend.$kind === 'Single' ? { kind: 'single' } : { kind: 'multi' };

/** Collapses `price_fn_is_*`, `price_fn_kind`, `price_fn_fixed_delta`, `price_fn_compound_delta_*`. */
export const priceEscalation: View<PriceEscalation> = (state) => {
  const p = ensemble(state).price_escalation;
  return p.$kind === 'FixedDelta'
    ? { kind: 'fixedDelta', deltaMist: mist(p.FixedDelta.delta.mist) }
    : {
        kind: 'compoundDelta',
        bps: bps(p.CompoundDelta.bps.bps),
        deltaMist: mist(p.CompoundDelta.delta.mist),
      };
};

/** Mirrors `price_fn_delta_mist` (delta common to both variants). */
export const priceEscalationDeltaMist: View<Mist> = (state, t) => {
  const p = priceEscalation(state, t);
  return p.deltaMist;
};

type CommitmentPolicyData = ReturnType<typeof core>['retire_commitment']['policy'];

function collapseCommitment(policy: CommitmentPolicyData): Commitment {
  return policy.$kind === 'Immediate'
    ? { kind: 'immediate' }
    : { kind: 'deferred', floorMs: ms(policy.Deferred.floor.ms) };
}

/** Collapses `retire_commitment_is_*`, `retire_commitment_kind`, `retire_commitment_floor_ms`. */
export const retireCommitment: View<Commitment> = (state) =>
  collapseCommitment(core(state).retire_commitment.policy);

/** Collapses `ensemble_commitment_is_*`, `ensemble_commitment_kind`, `ensemble_commitment_floor_ms`. */
export const ensembleCommitment: View<Commitment> = (state) =>
  collapseCommitment(core(state).ensemble_commitment.policy as CommitmentPolicyData);
