/**
 * The `Market` (Layer 2) — a governor's core decision in human units, mapped to
 * the kernel ensemble DSL (`src/config/ensemble.ts`). Prices are `Price`, times
 * are `Duration` ('7d'/'1h'/ms), shapes/commitments are named — none of it is
 * hidden (it's the most important thing a governor configures).
 */
import { type Bps, bps as toBps, type Ms, ms as toMs } from '../primitives/brand.js';
import type {
  EnsembleCommitmentConfig,
  EnsembleConfig,
  RetireCommitmentConfig,
  ShapeConfig,
} from '../config/ensemble.js';
import type { CoinTag, Price } from './value.js';

/** A duration: `'7d'`/`'12h'`/`'30m'`/`'25s'`/`'500ms'`, or a number of ms. */
export type Duration = `${number}${'ms' | 's' | 'm' | 'h' | 'd'}` | number;

/** A curve shape, in human form. */
export type Shape =
  | 'linear'
  | 'smoothstep'
  | 'logistic'
  | { readonly powerLaw: { readonly num: number; readonly den: number } }
  | { readonly exponential: { readonly alpha: number } }; // signed; alpha<0 ⇒ decaying

/** A governor's trust promise: act now, or bind its hands for a while. */
export type Commitment = 'immediate' | { readonly deferredFor: Duration };

/** The full market: pricing + dynamics + the trust commitments. */
export interface Market {
  // pricing & tenure
  readonly restPrice: Price;
  readonly tenure: Duration;
  readonly coin: CoinTag;
  readonly multiTenure?: boolean;
  // dynamics
  readonly creditShape?: Shape;
  readonly auctionShape?: Shape;
  readonly descent?: 'off' | Duration;
  readonly handover?: 'off' | 'fullTenure' | Duration;
  readonly escalation?:
    | { readonly fixed: Price }
    | { readonly compound: { readonly bps: number | bigint; readonly delta: Price } };
  // commitments
  readonly retireCommitment?: Commitment;
  readonly ensembleCommitment?: Commitment;
}

const UNIT_MS: Record<string, bigint> = {
  ms: 1n,
  s: 1_000n,
  m: 60_000n,
  h: 3_600_000n,
  d: 86_400_000n,
};

/** Parse a {@link Duration} to `Ms`. */
export function duration(d: Duration): Ms {
  if (typeof d === 'number') return toMs(BigInt(Math.round(d)));
  const m = /^(\d+)(ms|s|m|h|d)$/.exec(d);
  if (!m) throw new Error(`invalid duration: ${d}`);
  return toMs(BigInt(m[1]!) * UNIT_MS[m[2]!]!);
}

function shapeToConfig(s: Shape): ShapeConfig {
  if (s === 'linear' || s === 'smoothstep' || s === 'logistic') return { kind: s };
  if ('powerLaw' in s) return { kind: 'powerLaw', alphaNum: s.powerLaw.num, alphaDen: s.powerLaw.den };
  const a = s.exponential.alpha;
  return { kind: 'exponential', alphaAbs: Math.abs(a), alphaNeg: a < 0 };
}

/** Map a {@link Commitment} to the kernel's commitment config. */
export function toCommitmentConfig(c: Commitment): RetireCommitmentConfig {
  return c === 'immediate' ? { kind: 'immediate' } : { kind: 'deferred', floorMs: duration(c.deferredFor) };
}

/** Map a {@link Market} to the kernel's ensemble + commitment configs. */
export function toEnsembleConfig(market: Market): {
  ensemble: EnsembleConfig;
  retireCommitment?: RetireCommitmentConfig;
  ensembleCommitment?: EnsembleCommitmentConfig;
} {
  const ensemble: EnsembleConfig = {
    restPrice: market.restPrice.mist,
    tenureMs: duration(market.tenure),
    ...(market.multiTenure != null ? { multiTenure: market.multiTenure } : {}),
    ...(market.handover != null
      ? {
          handover:
            market.handover === 'off'
              ? { kind: 'off' as const }
              : market.handover === 'fullTenure'
                ? { kind: 'fullTenure' as const }
                : { kind: 'fixed' as const, floorMs: duration(market.handover) },
        }
      : {}),
    ...(market.descent != null
      ? {
          descent:
            market.descent === 'off'
              ? { kind: 'off' as const }
              : { kind: 'fixed' as const, ceilingMs: duration(market.descent) },
        }
      : {}),
    ...(market.creditShape != null ? { creditShape: shapeToConfig(market.creditShape) } : {}),
    ...(market.auctionShape != null ? { auctionShape: shapeToConfig(market.auctionShape) } : {}),
    ...(market.escalation != null
      ? {
          escalation:
            'fixed' in market.escalation
              ? { kind: 'fixedDelta' as const, deltaMist: market.escalation.fixed.mist }
              : {
                  kind: 'compoundDelta' as const,
                  bps: toBps(market.escalation.compound.bps) as Bps,
                  deltaMist: market.escalation.compound.delta.mist,
                },
        }
      : {}),
  };

  return {
    ensemble,
    ...(market.retireCommitment != null
      ? { retireCommitment: toCommitmentConfig(market.retireCommitment) }
      : {}),
    ...(market.ensembleCommitment != null
      ? { ensembleCommitment: toCommitmentConfig(market.ensembleCommitment) }
      : {}),
  };
}
