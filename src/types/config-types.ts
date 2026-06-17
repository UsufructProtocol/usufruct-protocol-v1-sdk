/**
 * Shared policy/config TYPE declarations — the §5.1 enum-collapse unions.
 *
 * These live in the drift-zero core so both the on-chain Reader
 * (`read/reader.ts`, `highlevel/marketReadback.ts`) and the opt-in mirror
 * (`views/config.ts`, which holds the runtime collapse functions) import them
 * from one place. The core never *computes* these unions — it only types the
 * Reader's decoded return values — so the declarations belong here, in core,
 * not in the mirror. The runtime `collapse*` projections stay in `views/`.
 */
import type { Bps, Mist, Ms } from '../primitives/brand.js';

export type CurveShape =
  | { readonly kind: 'linear' }
  | { readonly kind: 'smoothstep' }
  | { readonly kind: 'logistic' }
  | { readonly kind: 'powerLaw'; readonly alphaNum: number; readonly alphaDen: number }
  | { readonly kind: 'exponential'; readonly alphaAbs: number; readonly alphaNeg: boolean };

export type AuctionWindow =
  | { readonly kind: 'off' }
  | { readonly kind: 'fixed'; readonly ceilingMs: Ms };

export type Handover =
  | { readonly kind: 'off' }
  | { readonly kind: 'fullTenure' }
  | { readonly kind: 'fixed'; readonly floorMs: Ms };

export type RestPrice = { readonly kind: 'fixed'; readonly priceMist: Mist };

export type TenureDuration = { readonly kind: 'fixed'; readonly ceilingMs: Ms };

export type TenureExtend = { readonly kind: 'single' } | { readonly kind: 'multi' };

export type PriceEscalation =
  | { readonly kind: 'fixedDelta'; readonly deltaMist: Mist }
  | { readonly kind: 'compoundDelta'; readonly bps: Bps; readonly deltaMist: Mist };

export type Commitment =
  | { readonly kind: 'immediate' }
  | { readonly kind: 'deferred'; readonly floorMs: Ms };
