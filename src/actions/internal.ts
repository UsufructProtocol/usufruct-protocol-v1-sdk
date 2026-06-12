/**
 * Shared pure helpers for `Action.step` implementations. The cycle-params
 * resolution mirror lives with the views (it backs `pendingCycleParams`
 * too); re-exported here for the actions that consume it.
 */
export { resolveCycleParams, type CycleParamsData } from '../views/internal.js';
