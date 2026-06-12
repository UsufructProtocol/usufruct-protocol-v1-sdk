/**
 * Shared pure helpers for `Action.step` implementations. These mirror the
 * package-private resolution functions in the Move engine.
 */
import type { EnsembleData } from '../views/internal.js';

/** Decoded `CycleParams` in parsed (string-u64) form. */
export interface CycleParamsData {
  readonly floor: { readonly mist: string };
  readonly ceiling: { readonly ms: string };
  readonly handover: { readonly ms: string };
  readonly descent: { readonly ms: string };
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
