import { describe, expect, it } from 'vitest';
import { duration, toEnsembleConfig, type Market } from '../src/highlevel/market.js';
import { SUI, price } from '../src/highlevel/value.js';

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
  it('maps pricing + tenure to mist/ms', () => {
    const m: Market = { restPrice: SUI(0.5), tenure: '1d', coin: SUI };
    const { ensemble } = toEnsembleConfig(m);
    expect(ensemble.restPrice).toBe(500_000_000n);
    expect(ensemble.tenureMs).toBe(86_400_000n);
  });

  it('maps handover / descent variants', () => {
    expect(toEnsembleConfig({ restPrice: SUI(1), tenure: '1d', coin: SUI, handover: 'off' }).ensemble.handover)
      .toEqual({ kind: 'off' });
    expect(toEnsembleConfig({ restPrice: SUI(1), tenure: '1d', coin: SUI, handover: 'fullTenure' }).ensemble.handover)
      .toEqual({ kind: 'fullTenure' });
    expect(toEnsembleConfig({ restPrice: SUI(1), tenure: '1d', coin: SUI, handover: '1h' }).ensemble.handover)
      .toEqual({ kind: 'fixed', floorMs: 3_600_000n });
    expect(toEnsembleConfig({ restPrice: SUI(1), tenure: '1d', coin: SUI, descent: '12h' }).ensemble.descent)
      .toEqual({ kind: 'fixed', ceilingMs: 43_200_000n });
  });

  it('maps shapes, including signed exponential alpha', () => {
    const { ensemble } = toEnsembleConfig({
      restPrice: SUI(1), tenure: '1d', coin: SUI,
      creditShape: 'smoothstep',
      auctionShape: { exponential: { alpha: -3 } },
    });
    expect(ensemble.creditShape).toEqual({ kind: 'smoothstep' });
    expect(ensemble.auctionShape).toEqual({ kind: 'exponential', alphaAbs: 3, alphaNeg: true });
    expect(toEnsembleConfig({ restPrice: SUI(1), tenure: '1d', coin: SUI, creditShape: { powerLaw: { num: 2, den: 3 } } })
      .ensemble.creditShape).toEqual({ kind: 'powerLaw', alphaNum: 2, alphaDen: 3 });
  });

  it('maps escalation (fixed + compound)', () => {
    expect(toEnsembleConfig({ restPrice: SUI(1), tenure: '1d', coin: SUI, escalation: { fixed: SUI(0.05) } })
      .ensemble.escalation).toEqual({ kind: 'fixedDelta', deltaMist: 50_000_000n });
    expect(toEnsembleConfig({ restPrice: SUI(1), tenure: '1d', coin: SUI, escalation: { compound: { bps: 100, delta: price(7n) } } })
      .ensemble.escalation).toEqual({ kind: 'compoundDelta', bps: 100n, deltaMist: 7n });
  });

  it('maps commitments as separate configs', () => {
    const { retireCommitment, ensembleCommitment } = toEnsembleConfig({
      restPrice: SUI(1), tenure: '1d', coin: SUI,
      retireCommitment: 'immediate',
      ensembleCommitment: { deferredFor: '7d' },
    });
    expect(retireCommitment).toEqual({ kind: 'immediate' });
    expect(ensembleCommitment).toEqual({ kind: 'deferred', floorMs: 604_800_000n });
  });

  it('omits absent optional fields entirely', () => {
    const { ensemble, retireCommitment, ensembleCommitment } = toEnsembleConfig({
      restPrice: SUI(1), tenure: '1d', coin: SUI,
    });
    expect('handover' in ensemble).toBe(false);
    expect('escalation' in ensemble).toBe(false);
    expect(retireCommitment).toBeUndefined();
    expect(ensembleCommitment).toBeUndefined();
  });
});
