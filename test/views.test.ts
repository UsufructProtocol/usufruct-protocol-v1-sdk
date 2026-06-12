import { describe, expect, it } from 'vitest';
import { ms } from '../src/primitives/brand.js';
import * as views from '../src/views/index.js';
import {
  ASSET_ID,
  GOV_CAP_ID,
  TENANT,
  defaultCore,
  defaultEnsemble,
  descentState,
  idleState,
  occupiedState,
  retiredState,
  syntheticState,
} from './synthetic.js';

const t0 = ms(0);

describe('status views', () => {
  it('classifies each reachable variant', () => {
    const idle = idleState();
    const occupied = occupiedState(10_000n);
    const retired = retiredState();
    const descent = descentState(10_000n);

    expect(views.isIdle(idle, t0)).toBe(true);
    expect(views.isRented(idle, t0)).toBe(false);

    expect(views.isOccupied(occupied, t0)).toBe(true);
    expect(views.isRented(occupied, t0)).toBe(true);
    expect(views.isIdle(occupied, t0)).toBe(false);

    expect(views.isRetired(retired, t0)).toBe(true);
    expect(views.isLive(retired, t0)).toBe(false);
    expect(views.isLive(idle, t0)).toBe(true);

    expect(views.isDescending(descent, t0)).toBe(true);
  });
});

describe('identity views', () => {
  it('reads asset id from locked and open custody', () => {
    expect(views.assetId(idleState(), t0)).toBe(ASSET_ID);
    expect(views.assetId(occupiedState(0n), t0)).toBe(ASSET_ID);
  });

  it('reads governance cap id and active usufructuary', () => {
    expect(views.governanceCapId(idleState(), t0)).toBe(GOV_CAP_ID);
    expect(views.activeUsufructuaryAddr(idleState(), t0)).toBeNull();
    expect(views.activeUsufructuaryAddr(occupiedState(0n), t0)).toBe(TENANT);
  });
});

describe('temporal views', () => {
  it('phaseStartMs per variant', () => {
    expect(views.phaseStartMs(idleState(), t0)).toBeNull();
    expect(views.phaseStartMs(occupiedState(10_000n), t0)).toBe(10_000n);
    expect(views.phaseStartMs(descentState(7_000n), t0)).toBe(7_000n);
  });

  it('tenureExpiryMs = phase_start + ceiling for rented states only', () => {
    expect(views.tenureExpiryMs(idleState(), t0)).toBeNull();
    expect(views.tenureExpiryMs(occupiedState(10_000n, 60_000n), t0)).toBe(70_000n);
  });

  it('nextTransitionMs mirrors compute_next_pending boundary semantics', () => {
    const occupied = occupiedState(10_000n, 60_000n); // boundary at 70_000
    expect(views.nextTransitionMs(occupied, ms(69_999))).toBeNull();
    expect(views.nextTransitionMs(occupied, ms(70_000))).toBe(70_000n);
    expect(views.transitionIsReady(occupied, ms(70_000))).toBe(true);

    // Idle and Retired never have a pending transition.
    expect(views.nextTransitionMs(idleState(), ms(999_999_999))).toBeNull();
    expect(views.nextTransitionMs(retiredState(), ms(999_999_999))).toBeNull();

    const descent = descentState(10_000n); // descent window 30_000 → boundary 40_000
    expect(views.nextTransitionMs(descent, ms(39_999))).toBeNull();
    expect(views.nextTransitionMs(descent, ms(40_000))).toBe(40_000n);
  });
});

describe('config views (enum collapse §5.1)', () => {
  it('collapses every CurveShape variant exhaustively', () => {
    const shapes = [
      [{ Linear: true }, { kind: 'linear' }],
      [{ Smoothstep: true }, { kind: 'smoothstep' }],
      [{ Logistic: true }, { kind: 'logistic' }],
      [
        { PowerLaw: { alpha_num: 3, alpha_den: 2 } },
        { kind: 'powerLaw', alphaNum: 3, alphaDen: 2 },
      ],
      [
        { Exponential: { alpha_abs: 5, alpha_neg: true } },
        { kind: 'exponential', alphaAbs: 5, alphaNeg: true },
      ],
    ] as const;

    for (const [moveShape, collapsed] of shapes) {
      const state = syntheticState(
        { Waiting: { Retired: { asset: { asset: { id: ASSET_ID } } } } },
        {
          ...defaultCore,
          ensemble: {
            active: { ...defaultEnsemble, credit_shape: moveShape },
            pending: null,
          },
        },
      );
      expect(views.creditShape(state, t0)).toEqual(collapsed);
    }
  });
});
