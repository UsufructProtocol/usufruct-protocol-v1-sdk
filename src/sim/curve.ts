/**
 * Bit-exact mirror of the protocol's fixed-point curve & settlement math
 * (SPEC §8.1). Transcribed verbatim from `policies/curve_shape_policy.move`,
 * `primitives/math.move`, `domain/{monetary,tenures}.move`.
 *
 * Rigor rules (do not "improve" the arithmetic):
 * - Everything is `bigint`. No floats — they would diverge from the integer
 *   truth at the low bits.
 * - Division truncates toward zero; all operands here are non-negative, so it
 *   equals Move's flooring `/`.
 * - `mulDiv` widens to u128 and asserts the u64 bound, exactly like Move.
 * - Constants and lookup tables are copied character-for-character from source.
 *
 * Pinned against the protocol's own golden vectors in test/curve-golden.test.ts.
 */
import type { CurveShape } from '../views/config.js';

// ── constants (curve_shape_policy.move) ──
const SCALE = 1_000_000_000n;
const SCALE_SQ = 1_000_000_000_000_000_000n;
const SCALE_CB = 1_000_000_000_000_000_000_000_000_000n;
const TAYLOR_SCALE = 1_000_000_000_000_000_000n;
const TAYLOR_SCALE_SQ = 1_000_000_000_000_000_000_000_000_000_000_000_000n;

const LOGISTIC_K = 12n;
const LOGISTIC_DENOM = 995_054_753n;
const LOGISTIC_SIGMA_FLOOR = (SCALE - LOGISTIC_DENOM) / 2n; // = 2_472_623

// exp_a_norm tables, indexed by alpha_abs (1..8) → [abs-1]
const EXP_A_NORM_POS: readonly bigint[] = [
  1_718_281_828_459_045_226n,
  6_389_056_098_930_650_216n,
  19_085_536_923_187_667_729n,
  53_598_150_033_144_239_050n,
  147_413_159_102_576_587_697n,
  402_428_793_492_728_453_424n,
  1_095_633_158_427_339_529_377n,
  2_979_957_986_946_523_322_343n,
];
const EXP_A_NORM_NEG: readonly bigint[] = [
  632_120_558_828_557_678n,
  864_664_716_763_387_308n,
  950_212_931_632_136_057n,
  981_684_361_111_265_820n,
  993_262_053_000_914_533n,
  997_521_247_823_333_601n,
  999_088_118_034_444_554n,
  999_664_537_372_086_775n,
];

// ── constants (math.move / monetary) ──
export const BPS_DENOMINATOR = 10_000n;
export const PROTOCOL_FEE_BPS = 1_000n;
const U64_MAX = (1n << 64n) - 1n;

// ── math.move primitives ──

/** `math::compute_mul_div` — (a*b)/c via u128, truncating, u64-bounded. */
export function mulDiv(a: bigint, b: bigint, c: bigint): bigint {
  const res = (a * b) / c;
  if (res > U64_MAX) throw new Error('EMulDivOverflow');
  return res;
}

/** `math::compute_nth_root_u128` — Newton's method, degree d ∈ [2,4]. */
export function nthRootU128(n: bigint, d: number): bigint {
  if (d < 2 || d > 4) throw new Error('ENthRootBadDegree');
  if (n === 0n) return 0n;
  if (n === 1n) return 1n;
  const bits = BigInt(n.toString(2).length); // = Move bit_length(n)
  const dB = BigInt(d);
  const shift = (bits + dB - 1n) / dB;
  let x = 1n << shift;
  const dMinusOne = dB - 1n;
  for (;;) {
    const xPow = d === 2 ? x : d === 3 ? x * x : x * x * x;
    const xNew = (dMinusOne * x + n / xPow) / dB;
    if (xNew >= x) return x;
    x = xNew;
  }
}

/** `exp_scaled_pos` — Taylor series of e^(y_num/y_den), TAYLOR_SCALE-fixed, 32 terms. */
function expScaledPos(yNum: bigint, yDen: bigint): bigint {
  let acc = TAYLOR_SCALE;
  let term = TAYLOR_SCALE;
  let k = 1n;
  while (k <= 32n) {
    term = (term * yNum) / (k * yDen);
    if (term === 0n) break;
    acc = acc + term;
    k = k + 1n;
  }
  return acc;
}

/** `exp_scaled` — reciprocal via TAYLOR_SCALE_SQ when `neg`. */
function expScaled(yNum: bigint, yDen: bigint, neg: boolean): bigint {
  const pos = expScaledPos(yNum, yDen);
  return neg ? TAYLOR_SCALE_SQ / pos : pos;
}

// ── curve evaluators (the Partial branch; no t==0 / t>=t_max short-circuit) ──

export function evalLinear(t: bigint, tMax: bigint): bigint {
  return mulDiv(t, SCALE, tMax);
}

export function evalSmoothstep(t: bigint, tMax: bigint): bigint {
  const x = mulDiv(t, SCALE, tMax);
  const num = x * x * (3n * SCALE - 2n * x);
  return num / SCALE_SQ;
}

export function evalPowerLaw(t: bigint, tMax: bigint, alphaNum: number, alphaDen: number): bigint {
  const x = mulDiv(t, SCALE, tMax);
  let acc = x;
  for (let i = 0; i < alphaNum - 1; i++) acc = mulDiv(acc, x, SCALE);
  if (alphaDen === 1) return acc;
  const scalePow = alphaDen === 2 ? SCALE : alphaDen === 3 ? SCALE_SQ : SCALE_CB;
  return nthRootU128(acc * scalePow, alphaDen);
}

export function evalExponential(
  t: bigint,
  tMax: bigint,
  alphaAbs: number,
  alphaNeg: boolean,
): bigint {
  const a = BigInt(alphaAbs);
  const expAx = expScaled(a * t, tMax, alphaNeg);
  const num = alphaNeg ? TAYLOR_SCALE - expAx : expAx - TAYLOR_SCALE;
  const den = alphaNeg ? EXP_A_NORM_NEG[alphaAbs - 1]! : EXP_A_NORM_POS[alphaAbs - 1]!;
  return (num * SCALE) / den;
}

export function evalLogistic(t: bigint, tMax: bigint): bigint {
  const twoT = 2n * t;
  let yNumAbs: bigint;
  let yNeg: boolean;
  if (twoT >= tMax) {
    yNumAbs = LOGISTIC_K * (twoT - tMax);
    yNeg = false;
  } else {
    yNumAbs = LOGISTIC_K * (tMax - twoT);
    yNeg = true;
  }
  const yDen = 2n * tMax;
  const ey = expScaled(yNumAbs, yDen, yNeg);
  const sigmaY = (ey * SCALE) / (ey + TAYLOR_SCALE);
  return ((sigmaY - LOGISTIC_SIGMA_FLOOR) * SCALE) / LOGISTIC_DENOM;
}

// ── dispatch (compute_curve_height: progress + eval) ──

/**
 * `curve_shape_policy::compute_curve_height(shape, progress(elapsed, dur))`.
 * Height ∈ [0, SCALE]. `elapsed`/`dur` are ms (the protocol's progress units).
 */
export function curveHeight(shape: CurveShape, elapsed: bigint, dur: bigint): bigint {
  if (elapsed === 0n) return 0n; // Progress::Zero
  if (elapsed >= dur) return SCALE; // Progress::Complete
  const t = elapsed;
  const tMax = dur;
  switch (shape.kind) {
    case 'linear':
      return evalLinear(t, tMax);
    case 'smoothstep':
      return evalSmoothstep(t, tMax);
    case 'logistic':
      return evalLogistic(t, tMax);
    case 'powerLaw':
      return evalPowerLaw(t, tMax, shape.alphaNum, shape.alphaDen);
    case 'exponential':
      return evalExponential(t, tMax, shape.alphaAbs, shape.alphaNeg);
  }
}

/** `compute_scaled_value(amount, height)` = mulDiv(amount, height, SCALE). */
export function scaledValue(amount: bigint, height: bigint): bigint {
  return mulDiv(amount, height, SCALE);
}

// ── settlement (asset_state split_fee_amounts + math::compute_apply_bps) ──

export function applyBps(amount: bigint, bps: bigint): bigint {
  return mulDiv(amount, bps, BPS_DENOMINATOR);
}

export interface FeeSplit {
  readonly governorShare: bigint;
  readonly fee: bigint;
}

/** `split_fee_amounts(amount)` — 10% protocol fee, remainder to governor. */
export function splitFee(amount: bigint): FeeSplit {
  const fee = applyBps(amount, PROTOCOL_FEE_BPS);
  return { governorShare: amount - fee, fee };
}

// ── price escalation (price_escalation_policy.move) ──

export function fixedDelta(price: bigint, delta: bigint): bigint {
  const sum = price + delta;
  if (sum > U64_MAX) throw new Error('EPriceAddOverflow');
  return sum;
}

export function compoundDelta(price: bigint, bps: bigint, delta: bigint): bigint {
  const scaled = mulDiv(price, BPS_DENOMINATOR + bps, BPS_DENOMINATOR);
  const r = scaled + delta;
  if (r > U64_MAX) throw new Error('EPriceAddOverflow');
  return r;
}

// ── tenure / duration math (tenures.move) ──

export function stakePerTenure(stakeMist: bigint, count: bigint): bigint {
  return mulDiv(stakeMist, 1n, count);
}
export function totalDuration(durationMs: bigint, count: bigint): bigint {
  return mulDiv(durationMs, count, 1n);
}
export function rescaledDuration(durationMs: bigint, from: bigint, to: bigint): bigint {
  return mulDiv(durationMs, to, from);
}

// ── composed pricing/credit (asset_state.move) ──

const elapsed = (nowMs: bigint, phaseStartMs: bigint): bigint =>
  nowMs >= phaseStartMs ? nowMs - phaseStartMs : 0n;

/** `descending_floor_price` — Dutch-auction price along the auction curve. */
export function descendingFloor(args: {
  readonly lastAcqMist: bigint;
  readonly phaseStartMs: bigint;
  readonly floorMist: bigint;
  readonly descentMs: bigint;
  readonly auctionShape: CurveShape;
  readonly nowMs: bigint;
}): bigint {
  const h = curveHeight(args.auctionShape, elapsed(args.nowMs, args.phaseStartMs), args.descentMs);
  const spread = args.lastAcqMist - args.floorMist; // compute_price_sub (last_acq ≥ floor)
  if (spread < 0n) throw new Error('descendingFloor: last_acq < floor');
  const consumed = scaledValue(spread, h);
  return args.lastAcqMist - consumed;
}

/** Accrued (used) credit = stake · creditHeight(elapsed/ceiling). */
export function usedCredit(args: {
  readonly stakeMist: bigint;
  readonly phaseStartMs: bigint;
  readonly creditShape: CurveShape;
  readonly ceilingMs: bigint;
  readonly nowMs: bigint;
}): bigint {
  const h = curveHeight(args.creditShape, elapsed(args.nowMs, args.phaseStartMs), args.ceilingMs);
  return scaledValue(args.stakeMist, h);
}
