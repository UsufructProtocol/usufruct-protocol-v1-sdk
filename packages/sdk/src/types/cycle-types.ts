/**
 * Cycle-params TYPE declarations — the record collapse of the unrolled
 * `{active,pending,next}_ensemble_*` Move views, plus the decoded
 * `CycleParams` shape.
 *
 * In core (typed by the Reader's returns and by the mirror's projections).
 * See `types/config-types.ts` for the rationale.
 */
import type { Mist, Ms } from '../primitives/brand.js';

export interface CycleParamsView {
  readonly floorMist: Mist;
  readonly ceilingMs: Ms;
  readonly handoverMs: Ms;
  readonly descentMs: Ms;
}

/** Decoded `CycleParams` in parsed (string-u64) form. */
export interface CycleParamsData {
  readonly floor: { readonly mist: string };
  readonly ceiling: { readonly ms: string };
  readonly handover: { readonly ms: string };
  readonly descent: { readonly ms: string };
}
