/**
 * Config views — the §5.1 enum collapse. One discriminated union replaces
 * the nine unrolled `credit_shape_is_*` / `credit_shape_*_alpha_*` Move views.
 */
import type { View } from '../primitives/view.js';
import { ensemble } from './internal.js';

export type CurveShape =
  | { readonly kind: 'linear' }
  | { readonly kind: 'smoothstep' }
  | { readonly kind: 'logistic' }
  | { readonly kind: 'powerLaw'; readonly alphaNum: number; readonly alphaDen: number }
  | { readonly kind: 'exponential'; readonly alphaAbs: number; readonly alphaNeg: boolean };

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
