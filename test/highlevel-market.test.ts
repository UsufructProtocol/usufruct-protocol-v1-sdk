import { describe, expect, it } from 'vitest';
import { duration, toEnsembleConfig, type Market } from '@usufruct-protocol/sdk/highlevel/market.js';
import { SUI, price } from '@usufruct-protocol/sdk/highlevel/value.js';

describe('highlevel/market — duration parser', () => {
  it('parses every unit', () => {
    expect(duration('500ms')).toBe(500n);
    expect(duration('25s')).toBe(25_000n);
    expect(duration('30m')).toBe(1_800_000n);
    expect(duration('1h')).toBe(3_600_000n);
    expect(duration('7d')).toBe(604_800_000n);
  });
  it('passes a raw number through as ms', () => {
    expect(duration(1_234)).toBe(1_234n);
  });
  it('throws on garbage', () => {
    expect(() => duration('soon' as never)).toThrow();
  });
});

describe('highlevel/market — toEnsembleConfig', () => {
  // A complete market (every field required) — tests override one field at a time.
  const full = (over: Partial<Market> = {}): Market => ({
    restPrice: SUI(1),
    tenure: '1d',
    multiTenure: false,
    creditShape: 'linear',
    auctionShape: 'linear',
    descent: 'off',
    handover: 'off',
    escalation: { fixed: SUI(0.001) },
    retireCommitment: 'immediate',
    ensembleCommitment: 'immediate',
    ...over,
  });

  it('maps pricing + tenure to mist/ms', () => {
    const { ensemble } = toEnsembleConfig(full({ restPrice: SUI(0.5), tenure: '1d' }));
    expect(ensemble.restPrice).toBe(500_000_000n);
    expect(ensemble.tenureMs).toBe(86_400_000n);
  });

  it('maps handover / descent variants', () => {
    expect(toEnsembleConfig(full({ handover: 'off' })).ensemble.handover).toEqual({ kind: 'off' });
    expect(toEnsembleConfig(full({ handover: 'fullTenure' })).ensemble.handover).toEqual({ kind: 'fullTenure' });
    expect(toEnsembleConfig(full({ handover: '1h' })).ensemble.handover).toEqual({ kind: 'fixed', floorMs: 3_600_000n });
    expect(toEnsembleConfig(full({ descent: '12h' })).ensemble.descent).toEqual({ kind: 'fixed', ceilingMs: 43_200_000n });
  });

  it('maps shapes, including signed exponential alpha', () => {
    const { ensemble } = toEnsembleConfig(full({ creditShape: 'smoothstep', auctionShape: { exponential: { alpha: -3 } } }));
    expect(ensemble.creditShape).toEqual({ kind: 'smoothstep' });
    expect(ensemble.auctionShape).toEqual({ kind: 'exponential', alphaAbs: 3, alphaNeg: true });
    expect(toEnsembleConfig(full({ creditShape: { powerLaw: { num: 2, den: 3 } } })).ensemble.creditShape)
      .toEqual({ kind: 'powerLaw', alphaNum: 2, alphaDen: 3 });
  });

  it('maps escalation (fixed + compound) — the price always escalates, no off', () => {
    expect(toEnsembleConfig(full({ escalation: { fixed: SUI(0.05) } })).ensemble.escalation)
      .toEqual({ kind: 'fixedDelta', deltaMist: 50_000_000n });
    expect(toEnsembleConfig(full({ escalation: { compound: { bps: 100, delta: price(7n) } } })).ensemble.escalation)
      .toEqual({ kind: 'compoundDelta', bps: 100n, deltaMist: 7n });
  });

  it('maps commitments as separate, always-present configs', () => {
    const { retireCommitment, ensembleCommitment } = toEnsembleConfig(
      full({ retireCommitment: 'immediate', ensembleCommitment: { deferredFor: '7d' } }),
    );
    expect(retireCommitment).toEqual({ kind: 'immediate' });
    expect(ensembleCommitment).toEqual({ kind: 'deferred', floorMs: 604_800_000n });
  });

  it('every field is present in the mapped config (no defaults to fall back on)', () => {
    const { ensemble, retireCommitment, ensembleCommitment } = toEnsembleConfig(full());
    for (const k of ['restPrice', 'tenureMs', 'multiTenure', 'handover', 'descent', 'creditShape', 'auctionShape', 'escalation'] as const) {
      expect(k in ensemble).toBe(true);
    }
    expect(retireCommitment).toBeDefined();
    expect(ensembleCommitment).toBeDefined();
  });
});
