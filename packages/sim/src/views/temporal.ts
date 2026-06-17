/**
 * Temporal views — mirror `proj_phase_start`, `tenure_expiry_ms`, and
 * `compute_next_pending` (the lazy-transition agenda primitive).
 */
import type { Mist, Ms } from '@usufruct-protocol/sdk/primitives/brand.js';
import { bps, mist, ms } from '@usufruct-protocol/sdk/primitives/brand.js';
import type { View } from '../primitives/view.js';
import type { PriceEscalation } from './config.js';
import { assetState, core, rentingTerms } from './internal.js';

export const phaseStartMs: View<Ms | null> = (state) => {
  const s = assetState(state);
  if (s.$kind === 'Renting') {
    const terms = rentingTerms(s);
    return ms(terms!.schedule.phase_start.ms);
  }
  if (s.Waiting.$kind === 'Descent') return ms(s.Waiting.Descent.auction.phase_start.ms);
  return null;
};

export const tenureExpiryMs: View<Ms | null> = (state) => {
  const s = assetState(state);
  const terms = rentingTerms(s);
  if (terms === null) return null;
  return ms(BigInt(terms.schedule.phase_start.ms) + BigInt(terms.schedule.ceiling_total.ms));
};

/**
 * Mirrors `asset_state::compute_next_pending(s, now)`: the timestamp of the
 * transition that is due (boundary already crossed), or null when nothing is
 * firable yet.
 */
export const nextTransitionMs: View<Ms | null> = (state, t) => {
  const s = assetState(state);
  if (s.$kind === 'Waiting') {
    if (s.Waiting.$kind !== 'Descent') return null;
    const { auction, cycle } = s.Waiting.Descent;
    const boundary = BigInt(auction.phase_start.ms) + BigInt(cycle.descent.ms);
    return t >= boundary ? ms(boundary) : null;
  }
  if (s.Renting.$kind === 'Occupied') {
    const { schedule } = s.Renting.Occupied.terms;
    const boundary = BigInt(schedule.phase_start.ms) + BigInt(schedule.ceiling_total.ms);
    return t >= boundary ? ms(boundary) : null;
  }
  const expiry = BigInt(s.Renting.Demand.bid.handover.expiry.ms);
  return t >= expiry ? ms(expiry) : null;
};

export const transitionIsReady: View<boolean> = (state, t) =>
  nextTransitionMs(state, t) !== null;

const saturating = (boundary: bigint, now: bigint): Ms =>
  ms(now >= boundary ? 0n : boundary - now);

/** Mirrors `handover_expiry_ms` — only set while a bid is pending (Demand). */
export const handoverExpiryMs: View<Ms | null> = (state) => {
  const s = assetState(state);
  if (s.$kind !== 'Renting' || s.Renting.$kind !== 'Demand') return null;
  return ms(s.Renting.Demand.bid.handover.expiry.ms);
};

/** Mirrors `active_usufructuary_time_remaining_ms(now)`. */
export const activeUsufructuaryTimeRemainingMs: View<Ms | null> = (state, t) => {
  const s = assetState(state);
  if (s.$kind !== 'Renting') return null;
  if (s.Renting.$kind === 'Occupied') {
    const { schedule } = s.Renting.Occupied.terms;
    return saturating(
      BigInt(schedule.phase_start.ms) + BigInt(schedule.ceiling_total.ms),
      t,
    );
  }
  return saturating(BigInt(s.Renting.Demand.bid.handover.expiry.ms), t);
};

/**
 * Factory mirroring `handover_expiry_if_bid_at(bid_time_ms)`:
 * `min(bid_t + resolved_handover, phase_start + resolved_ceiling)` —
 * only meaningful while Occupied.
 */
export const handoverExpiryIfBidAt =
  (bidTimeMs: Ms): View<Ms | null> =>
  (state) => {
    const s = assetState(state);
    if (s.$kind !== 'Renting' || s.Renting.$kind !== 'Occupied') return null;
    const { schedule } = s.Renting.Occupied.terms;
    const byHandover = bidTimeMs + BigInt(schedule.handover_total.ms);
    const byCeiling = BigInt(schedule.phase_start.ms) + BigInt(schedule.ceiling_total.ms);
    return ms(byHandover < byCeiling ? byHandover : byCeiling);
  };

/** Mirrors `tenure_ceiling_ms` (per-tenure ceiling from the active ensemble). */
export const tenureCeilingMs: View<Ms> = (state) => {
  const p = core(state).ensemble.active.tenure_duration;
  return ms(p.Fixed.ceiling.ms);
};

/** Mirrors `integrated_at_ms`. */
export const integratedAtMs: View<Ms> = (state) => ms(core(state).integrated_at.ms);

// ── Commitment timing — mirrors compute_unlock_at / compute_duration ──

type CommitmentSlot = ReturnType<typeof core>['retire_commitment'];

function commitmentUnlocksAt(slot: CommitmentSlot): bigint {
  const floor = slot.policy.$kind === 'Immediate' ? 0n : BigInt(slot.policy.Deferred.floor.ms);
  return BigInt(slot.anchor.ms) + floor;
}

export const retireCommitmentUnlocksAtMs: View<Ms> = (state) =>
  ms(commitmentUnlocksAt(core(state).retire_commitment));

export const retireCommitmentAnchorMs: View<Ms> = (state) =>
  ms(core(state).retire_commitment.anchor.ms);

export const retireCommitmentRemainingMs: View<Ms> = (state, t) =>
  saturating(commitmentUnlocksAt(core(state).retire_commitment), t);

export const ensembleCommitmentUnlocksAtMs: View<Ms> = (state) =>
  ms(commitmentUnlocksAt(core(state).ensemble_commitment as CommitmentSlot));

export const ensembleCommitmentAnchorMs: View<Ms> = (state) =>
  ms(core(state).ensemble_commitment.anchor.ms);

export const ensembleCommitmentRemainingMs: View<Ms> = (state, t) =>
  saturating(commitmentUnlocksAt(core(state).ensemble_commitment as CommitmentSlot), t);

// ── Credit accrual flags and auction memory ──

/** Mirrors `last_rent_price_mist` — the prior acquisition price, set in Descent. */
export const lastRentPriceMist: View<Mist | null> = (state) => {
  const s = assetState(state);
  if (s.$kind !== 'Waiting' || s.Waiting.$kind !== 'Descent') return null;
  return mist(s.Waiting.Descent.auction.last_acq_price.mist);
};

/** Mirrors `credit_is_accruing` — credit burns only while Occupied. */
export const creditIsAccruing: View<boolean> = (state) => {
  const s = assetState(state);
  return s.$kind === 'Renting' && s.Renting.$kind === 'Occupied';
};

/** Mirrors `credit_is_capped` — frozen at the handover expiry while Demand. */
export const creditIsCapped: View<boolean> = (state) => {
  const s = assetState(state);
  return s.$kind === 'Renting' && s.Renting.$kind === 'Demand';
};

/** Mirrors `credit_capped_at_ms`. */
export const creditCappedAtMs: View<Ms | null> = (state) => {
  const s = assetState(state);
  if (s.$kind !== 'Renting' || s.Renting.$kind !== 'Demand') return null;
  return ms(s.Renting.Demand.bid.handover.expiry.ms);
};

/** Mirrors `has_pending_ensemble_update`. */
export const hasPendingEnsembleUpdate: View<boolean> = (state) =>
  core(state).ensemble.pending != null;

/** Mirrors `pending_ensemble`, collapsed into the union views' shapes. */
export interface PendingEnsembleView {
  readonly restPriceMist: Mist;
  readonly tenureCeilingMs: Ms;
  readonly multiTenure: boolean;
  readonly priceEscalation: PriceEscalation;
}

export const pendingEnsemble: View<PendingEnsembleView | null> = (state) => {
  const p = core(state).ensemble.pending;
  if (p == null) return null;
  return {
    restPriceMist: mist(p.rest_price.Fixed.price.mist),
    tenureCeilingMs: ms(p.tenure_duration.Fixed.ceiling.ms),
    multiTenure: p.tenure_extend.$kind === 'Multi',
    priceEscalation:
      p.price_escalation.$kind === 'FixedDelta'
        ? { kind: 'fixedDelta', deltaMist: mist(p.price_escalation.FixedDelta.delta.mist) }
        : {
            kind: 'compoundDelta',
            bps: bps(p.price_escalation.CompoundDelta.bps.bps),
            deltaMist: mist(p.price_escalation.CompoundDelta.delta.mist),
          },
  };
};
