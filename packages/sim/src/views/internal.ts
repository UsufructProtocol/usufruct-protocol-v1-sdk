/**
 * Shared pure helpers for hand-written views. Mirrors the private accessors
 * in `escrow.move` (`read_state`, `read_core`, `read_ensemble`).
 */
import type { AssetSchema } from '@usufruct-protocol/sdk/primitives/state.js';
import type { EscrowState } from '../primitives/state.js';
import type { AssetStateData, CoreData, EnsembleData } from '../types/state-views.js';
import type { CycleParamsData } from '@usufruct-protocol/sdk/types/cycle-types.js';

// The projection types live in the mirror (`sim/types/`); re-export for back-compat.
export type {
  AssetStateData,
  CoreData,
  EnsembleData,
  OccupiedTermsData,
  RentingData,
} from '../types/state-views.js';
export type { CycleParamsData } from '@usufruct-protocol/sdk/types/cycle-types.js';

/** Mirrors `read_state`: aborts with EAssetBorrowed when the slot is empty. */
export function assetState(state: EscrowState<AssetSchema>): AssetStateData {
  const s = state.escrow.state;
  if (s == null) throw new Error('EAssetBorrowed: asset state slot is empty');
  return s;
}

/** Mirrors `read_core`. The core slot is only empty mid-transaction. */
export function core(state: EscrowState<AssetSchema>): CoreData {
  const c = state.escrow.core;
  if (c == null) throw new Error('Escrow core slot is empty');
  return c;
}

/** Mirrors `read_ensemble`. */
export function ensemble(state: EscrowState<AssetSchema>): EnsembleData {
  return core(state).ensemble.active;
}

/** Renting terms (`Occupied` or `Demand`), or null when waiting. */
export function rentingTerms(s: AssetStateData) {
  if (s.$kind !== 'Renting') return null;
  const r = s.Renting;
  return r.$kind === 'Occupied' ? r.Occupied.terms : r.Demand.terms;
}

/** Mirrors `asset_state::resolve_cycle_params(ensemble)`. */
export function resolveCycleParams(ensemble: EnsembleData): CycleParamsData {
  const rest = ensemble.rest_price;
  if (rest.$kind !== 'Fixed') throw new Error(`Unknown RestPricePolicy: ${rest.$kind}`);
  const floor = rest.Fixed.price.mist;

  const dur = ensemble.tenure_duration;
  if (dur.$kind !== 'Fixed') throw new Error(`Unknown TenureDurationPolicy: ${dur.$kind}`);
  const ceiling = dur.Fixed.ceiling.ms;

  const h = ensemble.handover;
  const handover =
    h.$kind === 'Off' ? '0' : h.$kind === 'FullTenure' ? ceiling : h.Fixed.floor.ms;

  const w = ensemble.auction_window;
  const descent = w.$kind === 'Off' ? '0' : w.Fixed.ceiling.ms;

  return {
    floor: { mist: floor },
    ceiling: { ms: ceiling },
    handover: { ms: handover },
    descent: { ms: descent },
  };
}
