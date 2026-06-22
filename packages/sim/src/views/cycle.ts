/**
 * Cycle-params views — record collapse of the unrolled
 * `{cycle,pending_ensemble}_{floor_price_mist,ceiling_ms,handover_ms,descent_ms}`
 * Move views, plus the resolved tenancy totals. `cycle_*` is one cross-state view
 * (the active ensemble's resolved cycle); `pending_ensemble_*` is the scheduled one.
 */
import type { Ms } from '@usufruct-protocol/sdk/primitives/brand.js';
import { mist, ms } from '@usufruct-protocol/sdk/primitives/brand.js';
import type { View } from '../primitives/view.js';
import { assetState, core, rentingTerms, resolveCycleParams } from './internal.js';
import type { CycleParamsData, CycleParamsView } from '@usufruct-protocol/sdk/types/cycle-types.js';

// `CycleParamsView` now lives in core (`types/cycle-types.ts`); re-export for
// back-compat. This module keeps the runtime record-collapse projections.
export type { CycleParamsView };

function toView(c: CycleParamsData): CycleParamsView {
  return {
    floorMist: mist(c.floor.mist),
    ceilingMs: ms(c.ceiling.ms),
    handoverMs: ms(c.handover.ms),
    descentMs: ms(c.descent.ms),
  };
}

/** Collapses `cycle_*` — the resolved cycle of the active ensemble, cross-state.
 *  Non-null in every state but `retired` (which holds no cycle). */
export const cycleParams: View<CycleParamsView | null> = (state) => {
  const s = assetState(state);
  if (s.$kind === 'Renting') {
    const cycle = s.Renting.$kind === 'Occupied' ? s.Renting.Occupied.cycle : s.Renting.Demand.cycle;
    return toView(cycle);
  }
  if (s.Waiting.$kind === 'Retired') return null;
  const cycle = s.Waiting.$kind === 'Idle' ? s.Waiting.Idle.cycle : s.Waiting.Descent.cycle;
  return toView(cycle);
};

/** Collapses `pending_ensemble_*` — resolves the scheduled ensemble update. */
export const pendingCycleParams: View<CycleParamsView | null> = (state) => {
  const pending = core(state).ensemble.pending;
  return pending == null ? null : toView(resolveCycleParams(pending));
};

/** Mirrors `active_ceiling_total_ms` (resolved per committed tenures). */
export const activeCeilingTotalMs: View<Ms | null> = (state) => {
  const terms = rentingTerms(assetState(state));
  return terms === null ? null : ms(terms.schedule.ceiling_total.ms);
};

/** Mirrors `active_handover_total_ms`. */
export const activeHandoverTotalMs: View<Ms | null> = (state) => {
  const terms = rentingTerms(assetState(state));
  return terms === null ? null : ms(terms.schedule.handover_total.ms);
};
