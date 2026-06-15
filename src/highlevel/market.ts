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

/**
 * The full market: pricing + dynamics + the trust commitments. **Every field is
 * required** — no defaults. A market is a set of economic decisions; the API
 * makes the governor reason about each one, rather than inheriting a silent default.
 */
export interface Market {
  // pricing & tenure
  readonly restPrice: Price;
  readonly tenure: Duration;
  readonly coin: CoinTag;
  readonly multiTenure: boolean;
  // dynamics
  readonly creditShape: Shape;
  readonly auctionShape: Shape;
  readonly descent: 'off' | Duration;
  readonly handover: 'off' | 'fullTenure' | Duration;
  readonly escalation:
    | { readonly fixed: Price }
    | { readonly compound: { readonly bps: number | bigint; readonly delta: Price } };
  // commitments
  readonly retireCommitment: Commitment;
  readonly ensembleCommitment: Commitment;
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

function handoverToConfig(h: 'off' | 'fullTenure' | Duration): NonNullable<EnsembleConfig['handover']> {
  if (h === 'off') return { kind: 'off' };
  if (h === 'fullTenure') return { kind: 'fullTenure' };
  return { kind: 'fixed', floorMs: duration(h) };
}

function descentToConfig(d: 'off' | Duration): NonNullable<EnsembleConfig['descent']> {
  return d === 'off' ? { kind: 'off' } : { kind: 'fixed', ceilingMs: duration(d) };
}

function escalationToConfig(e: Market['escalation']): NonNullable<EnsembleConfig['escalation']> {
  return 'fixed' in e
    ? { kind: 'fixedDelta', deltaMist: e.fixed.mist }
    : { kind: 'compoundDelta', bps: toBps(e.compound.bps) as Bps, deltaMist: e.compound.delta.mist };
}

/** Map a {@link Market} (all fields required) to the kernel's ensemble + commitment configs. */
export function toEnsembleConfig(market: Market): {
  ensemble: EnsembleConfig;
  retireCommitment: RetireCommitmentConfig;
  ensembleCommitment: EnsembleCommitmentConfig;
} {
  return {
    ensemble: {
      restPrice: market.restPrice.mist,
      tenureMs: duration(market.tenure),
      multiTenure: market.multiTenure,
      handover: handoverToConfig(market.handover),
      descent: descentToConfig(market.descent),
      creditShape: shapeToConfig(market.creditShape),
      auctionShape: shapeToConfig(market.auctionShape),
      escalation: escalationToConfig(market.escalation),
    },
    retireCommitment: toCommitmentConfig(market.retireCommitment),
    ensembleCommitment: toCommitmentConfig(market.ensembleCommitment),
  };
}
