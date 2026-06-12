import { Transaction } from '@mysten/sui/transactions';
import { describe, expect, it } from 'vitest';
import { ensembleToPtb } from '../src/config/ensemble.js';
import { TESTNET } from '../src/config/network.js';
import { bps, mist, ms } from '../src/primitives/brand.js';

function targets(tx: Transaction): string[] {
  return tx.getData().commands.map((c) => {
    if (c.$kind !== 'MoveCall' || !c.MoveCall) return c.$kind;
    return `${c.MoveCall.module}::${c.MoveCall.function}`;
  });
}

describe('ensembleToPtb', () => {
  it('emits the full constructor chain for a representative config', () => {
    const tx = new Transaction();
    ensembleToPtb(tx, TESTNET, {
      restPrice: mist(1_000),
      tenureMs: ms(60_000),
      multiTenure: true,
      handover: { kind: 'fixed', floorMs: ms(5_000) },
      descent: { kind: 'fixed', ceilingMs: ms(30_000) },
      creditShape: { kind: 'powerLaw', alphaNum: 3, alphaDen: 2 },
      escalation: { kind: 'compoundDelta', bps: bps(100), deltaMist: mist(10) },
    });

    expect(targets(tx)).toEqual([
      'ensemble::price',
      'ensemble::new_rest_price_fixed',
      'ensemble::duration',
      'ensemble::new_tenure_duration_fixed',
      'ensemble::new_tenure_multi',
      'ensemble::duration',
      'ensemble::new_handover_fixed',
      'ensemble::duration',
      'ensemble::new_descent_fixed',
      'ensemble::new_power_law',
      'ensemble::new_linear',
      'ensemble::price',
      'ensemble::new_price_compound_delta',
      'ensemble::new_ensemble',
    ]);
  });

  it('defaults collapse to the minimal chain', () => {
    const tx = new Transaction();
    ensembleToPtb(tx, TESTNET, { restPrice: mist(1_000), tenureMs: ms(60_000) });
    expect(targets(tx)).toContain('ensemble::new_tenure_single');
    expect(targets(tx)).toContain('ensemble::new_handover_off');
    expect(targets(tx)).toContain('ensemble::new_descent_off');
  });
});
