/**
 * Curve golden vectors — the rigor gate for the tier-2 math mirror (SPEC §8.2).
 *
 * Every tuple is lifted verbatim from the protocol's own pinned tests
 * (`tests/policies/curve_shape_policy_tests.move`,
 * `tests/policies/price_escalation_policy_tests.move`), which are themselves
 * pinned to the deployed bytecode. If a constant in src/sim/curve.ts is
 * transcribed wrong, this fails before any testnet run.
 */
import { describe, expect, it } from 'vitest';
import * as c from '../src/sim/curve.js';

const SCALE = 1_000_000_000n;
const U64_MAX = 18_446_744_073_709_551_615n;

describe('curve dispatch edges (compute_curve_height)', () => {
  const lin = { kind: 'linear' } as const;
  it('Zero / Complete short-circuits', () => {
    expect(c.curveHeight(lin, 0n, 1_000_000_000n)).toBe(0n);
    expect(c.curveHeight(lin, 0n, 1n)).toBe(0n);
    expect(c.curveHeight(lin, 1n, 1n)).toBe(SCALE);
    expect(c.curveHeight(lin, 1_000_000_000n, 1_000_000_000n)).toBe(SCALE);
    expect(c.curveHeight(lin, 1_000_000_001n, 1_000_000_000n)).toBe(SCALE);
    expect(c.curveHeight(lin, U64_MAX, 1_000_000_000n)).toBe(SCALE);
  });
});

describe('eval_linear golden vectors', () => {
  it.each([
    [1n, 4n, 250_000_000n],
    [3n, 4n, 750_000_000n],
    [1n, 3n, 333_333_333n],
    [2n, 3n, 666_666_666n],
    [1n, 1_000_000_000n, 1n],
    [2n, 4n, 500_000_000n],
  ])('linear(%s,%s)=%s', (t, tMax, exp) => {
    expect(c.evalLinear(t, tMax)).toBe(exp);
  });
});

describe('eval_smoothstep golden vectors', () => {
  it.each([
    [1_000_000_000n, 4_000_000_000n, 156_250_000n],
    [2_000_000_000n, 4_000_000_000n, 500_000_000n],
    [3_000_000_000n, 4_000_000_000n, 843_750_000n],
    [2n, 4n, 500_000_000n],
  ])('smoothstep(%s,%s)=%s', (t, tMax, exp) => {
    expect(c.evalSmoothstep(t, tMax)).toBe(exp);
  });
});

describe('eval_power_law golden vectors', () => {
  it.each([
    // d=1
    [1_000_000_000n, 2_000_000_000n, 2, 1, 250_000_000n],
    [1_000_000_000n, 2_000_000_000n, 3, 1, 125_000_000n],
    [2n, 4n, 2, 1, 250_000_000n],
    [3n, 4n, 2, 1, 562_500_000n],
    [4_000_000_000n, 4_000_000_000n, 8, 1, 1_000_000_000n],
    // root step (d>1)
    [1n, 4n, 1, 2, 500_000_000n],
    [1n, 4n, 3, 2, 125_000_000n],
    [1n, 8n, 1, 3, 500_000_000n],
    [1n, 16n, 1, 4, 500_000_000n],
    [3n, 4n, 1, 2, 866_025_403n],
    [2_000_000_000n, 4_000_000_000n, 1, 2, 707_106_781n],
  ])('powerLaw(%s,%s,%s/%s)=%s', (t, tMax, num, den, exp) => {
    expect(c.evalPowerLaw(t, tMax, num as number, den as number)).toBe(exp);
  });
});

describe('eval_exponential golden vectors', () => {
  it.each([
    [1n, 4n, 2, false, 101_536_324n],
    [1n, 4n, 2, true, 455_054_233n],
    [1n, 4n, 4, false, 32_058_603n],
    [1n, 4n, 8, false, 2_144_008n],
    [1n, 4n, 8, true, 864_954_876n],
    [1n, 4n, 1, true, 349_932_008n],
    [2n, 4n, 2, false, 268_941_421n],
    [2n, 4n, 2, true, 731_058_578n],
  ])('exp(%s,%s,abs=%s,neg=%s)=%s', (t, tMax, abs, neg, exp) => {
    expect(c.evalExponential(t, tMax, abs as number, neg as boolean)).toBe(exp);
  });
});

describe('eval_logistic golden vectors', () => {
  it.each([
    [2_000_000_000n, 4_000_000_000n, 500_000_000n],
    [500n, 1_000n, 500_000_000n],
    [2n, 4n, 500_000_000n],
    [1_000_000_000n, 4_000_000_000n, 45_176_659n],
    [3_000_000_000n, 4_000_000_000n, 954_823_340n],
  ])('logistic(%s,%s)=%s', (t, tMax, exp) => {
    expect(c.evalLogistic(t, tMax)).toBe(exp);
  });
});

describe('price escalation golden vectors', () => {
  it.each([
    [100n, 50n, 150n],
    [1_000_000_000n, 1n, 1_000_000_001n],
    [1_000_000_000n, 1_000_000_000n, 2_000_000_000n],
    [0n, 1n, 1n],
    [18_446_744_073_709_551_614n, 1n, U64_MAX],
    [18_446_744_073_709_551_613n, 1n, 18_446_744_073_709_551_614n],
  ])('fixedDelta(%s,%s)=%s', (price, delta, exp) => {
    expect(c.fixedDelta(price, delta)).toBe(exp);
  });

  it.each([
    [10_000n, 500n, 1n, 10_501n],
    [1n, 500n, 1n, 2n],
    [200n, 50n, 1n, 202n],
    [199n, 50n, 1n, 200n],
    [1_000_000_000n, 10_000n, 1n, 2_000_000_001n],
    [0n, 500n, 1n, 1n],
    [9_999n, 1n, 1n, 10_000n],
    [10_000n, 1n, 1n, 10_002n],
    [20_000n, 1n, 1n, 20_003n],
    [1_000_000_000n, 1n, 1n, 1_000_100_001n],
  ])('compoundDelta(%s,bps=%s,delta=%s)=%s', (price, bps, delta, exp) => {
    expect(c.compoundDelta(price, bps, delta)).toBe(exp);
  });

  it('fixedDelta overflow aborts (u64::MAX + 1)', () => {
    expect(() => c.fixedDelta(U64_MAX, 1n)).toThrow(/EPriceAddOverflow/);
  });
});

describe('settlement split (10% protocol fee)', () => {
  it.each([
    [1_000n, 900n, 100n],
    [1_001n, 901n, 100n], // (1001*1000)/10000 = 100 (truncated)
    [9_999n, 9_000n, 999n],
  ])('splitFee(%s) = governor %s / fee %s', (amount, gov, fee) => {
    expect(c.splitFee(amount)).toEqual({ governorShare: gov, fee });
  });
  it('constants match the protocol', () => {
    expect(c.PROTOCOL_FEE_BPS).toBe(1_000n);
    expect(c.BPS_DENOMINATOR).toBe(10_000n);
  });
});
