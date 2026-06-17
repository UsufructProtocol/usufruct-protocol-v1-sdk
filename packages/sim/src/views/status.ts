/**
 * State predicates — mirror `asset_state::proj_is_*` term-by-term.
 */
import type { View } from '../primitives/view.js';
import { assetState } from './internal.js';

export const isIdle: View<boolean> = (state) => {
  const s = assetState(state);
  return s.$kind === 'Waiting' && s.Waiting.$kind === 'Idle';
};

export const isDescending: View<boolean> = (state) => {
  const s = assetState(state);
  return s.$kind === 'Waiting' && s.Waiting.$kind === 'Descent';
};

export const isRetired: View<boolean> = (state) => {
  const s = assetState(state);
  return s.$kind === 'Waiting' && s.Waiting.$kind === 'Retired';
};

export const isRented: View<boolean> = (state) => assetState(state).$kind === 'Renting';

export const isOccupied: View<boolean> = (state) => {
  const s = assetState(state);
  return s.$kind === 'Renting' && s.Renting.$kind === 'Occupied';
};

export const isDemand: View<boolean> = (state) => {
  const s = assetState(state);
  return s.$kind === 'Renting' && s.Renting.$kind === 'Demand';
};

export const isLive: View<boolean> = (state, t) => !isRetired(state, t);
