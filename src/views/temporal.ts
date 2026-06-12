/**
 * Temporal views — mirror `proj_phase_start`, `tenure_expiry_ms`, and
 * `compute_next_pending` (the lazy-transition agenda primitive).
 */
import type { Ms } from '../primitives/brand.js';
import { ms } from '../primitives/brand.js';
import type { View } from '../primitives/view.js';
import { assetState, rentingTerms } from './internal.js';

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
