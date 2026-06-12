import { describe, expect, it } from 'vitest';
import { ms } from '../src/primitives/brand.js';
import * as views from '../src/views/index.js';
import {
  ASSET_ID,
  defaultCore,
  defaultEnsemble,
  demandState,
  descentState,
  idleState,
  occupiedState,
  retiredState,
  syntheticState,
} from './synthetic.js';

const t0 = ms(0);

describe('cycle params views (record collapse)', () => {
  it('activeCycleParams only while renting', () => {
    expect(views.activeCycleParams(idleState(), t0)).toBeNull();
    expect(views.activeCycleParams(occupiedState(0n), t0)).toEqual({
      floorMist: 1_000n,
      ceilingMs: 60_000n,
      handoverMs: 0n,
      descentMs: 30_000n,
    });
  });

  it('nextCycleParams only while waiting (not retired)', () => {
    expect(views.nextCycleParams(occupiedState(0n), t0)).toBeNull();
    expect(views.nextCycleParams(retiredState(), t0)).toBeNull();
    expect(views.nextCycleParams(descentState(0n), t0)?.floorMist).toBe(1_000n);
  });

  it('pendingCycleParams resolves the scheduled ensemble', () => {
    expect(views.pendingCycleParams(idleState(), t0)).toBeNull();
    const withPending = syntheticState(
      { Waiting: { Retired: { asset: { asset: { id: ASSET_ID } } } } },
      {
        ...defaultCore,
        ensemble: {
          active: defaultEnsemble,
          pending: {
            ...defaultEnsemble,
            rest_price: { Fixed: { price: { mist: 5_000n } } },
            handover: { FullTenure: true },
          },
        },
      },
    );
    expect(views.pendingCycleParams(withPending, t0)).toEqual({
      floorMist: 5_000n,
      ceilingMs: 60_000n,
      handoverMs: 60_000n, // FullTenure resolves to the ceiling
      descentMs: 0n,
    });
    expect(views.hasPendingEnsembleUpdate(withPending, t0)).toBe(true);
    expect(views.pendingEnsemble(withPending, t0)?.restPriceMist).toBe(5_000n);
  });

  it('resolved tenancy totals', () => {
    const occupied = occupiedState(10_000n, 60_000n);
    expect(views.activeCeilingTotalMs(occupied, t0)).toBe(60_000n);
    expect(views.activeHandoverTotalMs(occupied, t0)).toBe(0n);
    expect(views.activeCeilingTotalMs(idleState(), t0)).toBeNull();
  });
});

describe('temporal/commitment views', () => {
  it('handover expiry and time remaining', () => {
    const demand = demandState(10_000n, 70_000n);
    expect(views.handoverExpiryMs(demand, t0)).toBe(70_000n);
    expect(views.handoverExpiryMs(occupiedState(0n), t0)).toBeNull();

    expect(views.activeUsufructuaryTimeRemainingMs(demand, ms(60_000))).toBe(10_000n);
    expect(views.activeUsufructuaryTimeRemainingMs(demand, ms(80_000))).toBe(0n);
    const occupied = occupiedState(10_000n, 60_000n); // expiry 70_000
    expect(views.activeUsufructuaryTimeRemainingMs(occupied, ms(50_000))).toBe(20_000n);
    expect(views.activeUsufructuaryTimeRemainingMs(idleState(), ms(0))).toBeNull();
  });

  it('handoverExpiryIfBidAt = min(bid+handover_total, phase_start+ceiling_total)', () => {
    // synthetic occupied has handover_total = 0 → expiry = bid time
    const occupied = occupiedState(10_000n, 60_000n);
    expect(views.handoverExpiryIfBidAt(ms(30_000))(occupied, t0)).toBe(30_000n);
    expect(views.handoverExpiryIfBidAt(ms(90_000))(occupied, t0)).toBe(70_000n);
    expect(views.handoverExpiryIfBidAt(ms(0))(idleState(), t0)).toBeNull();
  });

  it('tenure ceiling and integrated_at', () => {
    expect(views.tenureCeilingMs(idleState(), t0)).toBe(60_000n);
    expect(views.integratedAtMs(idleState(), t0)).toBe(1_000n);
  });

  it('commitment unlock arithmetic (immediate and deferred)', () => {
    const immediate = idleState(); // anchor 1_000, Immediate → unlocks at 1_000
    expect(views.retireCommitmentUnlocksAtMs(immediate, t0)).toBe(1_000n);
    expect(views.retireCommitmentAnchorMs(immediate, t0)).toBe(1_000n);
    expect(views.retireCommitmentRemainingMs(immediate, ms(500))).toBe(500n);
    expect(views.retireCommitmentRemainingMs(immediate, ms(2_000))).toBe(0n);

    const deferred = syntheticState(
      { Waiting: { Retired: { asset: { asset: { id: ASSET_ID } } } } },
      {
        ...defaultCore,
        ensemble_commitment: {
          policy: { Deferred: { floor: { ms: 8_000n } } },
          anchor: { ms: 2_000n },
        },
      },
    );
    expect(views.ensembleCommitmentUnlocksAtMs(deferred, t0)).toBe(10_000n);
    expect(views.ensembleCommitmentRemainingMs(deferred, ms(4_000))).toBe(6_000n);
  });

  it('credit flags and last rent price per state', () => {
    const occupied = occupiedState(0n);
    const demand = demandState(0n, 70_000n);
    const descent = descentState(5_000n);

    expect(views.creditIsAccruing(occupied, t0)).toBe(true);
    expect(views.creditIsAccruing(demand, t0)).toBe(false);
    expect(views.creditIsCapped(demand, t0)).toBe(true);
    expect(views.creditCappedAtMs(demand, t0)).toBe(70_000n);
    expect(views.creditCappedAtMs(occupied, t0)).toBeNull();

    expect(views.lastRentPriceMist(descent, t0)).toBe(1_000n);
    expect(views.lastRentPriceMist(occupied, t0)).toBeNull();
  });
});
