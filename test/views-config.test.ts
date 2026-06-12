import { describe, expect, it } from 'vitest';
import { ms } from '../src/primitives/brand.js';
import * as views from '../src/views/index.js';
import { defaultCore, defaultEnsemble, retiredState, syntheticState, ASSET_ID } from './synthetic.js';

const t0 = ms(0);

function stateWithEnsemble(overrides: Partial<typeof defaultEnsemble>) {
  return syntheticState(
    { Waiting: { Retired: { asset: { asset: { id: ASSET_ID } } } } },
    {
      ...defaultCore,
      ensemble: { active: { ...defaultEnsemble, ...overrides }, pending: null },
    },
  );
}

describe('policy union views (§5.1 broad collapse)', () => {
  it('auctionWindow', () => {
    expect(views.auctionWindow(stateWithEnsemble({}), t0)).toEqual({ kind: 'off' });
    expect(
      views.auctionWindow(
        stateWithEnsemble({ auction_window: { Fixed: { ceiling: { ms: 5_000n } } } }),
        t0,
      ),
    ).toEqual({ kind: 'fixed', ceilingMs: 5_000n });
  });

  it('handover — all three variants', () => {
    expect(views.handover(stateWithEnsemble({}), t0)).toEqual({ kind: 'off' });
    expect(
      views.handover(stateWithEnsemble({ handover: { FullTenure: true } }), t0),
    ).toEqual({ kind: 'fullTenure' });
    expect(
      views.handover(stateWithEnsemble({ handover: { Fixed: { floor: { ms: 7n } } } }), t0),
    ).toEqual({ kind: 'fixed', floorMs: 7n });
  });

  it('restPrice and tenureDuration', () => {
    const s = stateWithEnsemble({});
    expect(views.restPrice(s, t0)).toEqual({ kind: 'fixed', priceMist: 1_000n });
    expect(views.tenureDuration(s, t0)).toEqual({ kind: 'fixed', ceilingMs: 60_000n });
  });

  it('tenureExtend', () => {
    expect(views.tenureExtend(stateWithEnsemble({}), t0)).toEqual({ kind: 'single' });
    expect(
      views.tenureExtend(stateWithEnsemble({ tenure_extend: { Multi: true } }), t0),
    ).toEqual({ kind: 'multi' });
  });

  it('priceEscalation + delta common accessor', () => {
    const fixed = stateWithEnsemble({});
    expect(views.priceEscalation(fixed, t0)).toEqual({ kind: 'fixedDelta', deltaMist: 1n });
    expect(views.priceEscalationDeltaMist(fixed, t0)).toBe(1n);

    const compound = stateWithEnsemble({
      price_escalation: { CompoundDelta: { bps: { bps: 250n }, delta: { mist: 42n } } },
    });
    expect(views.priceEscalation(compound, t0)).toEqual({
      kind: 'compoundDelta',
      bps: 250n,
      deltaMist: 42n,
    });
    expect(views.priceEscalationDeltaMist(compound, t0)).toBe(42n);
  });

  it('retire/ensemble commitments', () => {
    const immediate = retiredState();
    expect(views.retireCommitment(immediate, t0)).toEqual({ kind: 'immediate' });
    expect(views.ensembleCommitment(immediate, t0)).toEqual({ kind: 'immediate' });

    const deferred = syntheticState(
      { Waiting: { Retired: { asset: { asset: { id: ASSET_ID } } } } },
      {
        ...defaultCore,
        retire_commitment: {
          policy: { Deferred: { floor: { ms: 9_000n } } },
          anchor: { ms: 1_000n },
        },
      },
    );
    expect(views.retireCommitment(deferred, t0)).toEqual({
      kind: 'deferred',
      floorMs: 9_000n,
    });
  });

  it('constants', () => {
    expect(views.PROTOCOL_FEE_BPS).toBe(1_000n);
    expect(views.BPS_DENOMINATOR).toBe(10_000n);
  });
});
