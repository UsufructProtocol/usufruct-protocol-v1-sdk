import { describe, expect, it, vi } from 'vitest';
import { bcs } from '@mysten/sui/bcs';
import { Transaction } from '@mysten/sui/transactions';
import type { ClientWithCoreApi } from '@mysten/sui/client';
import {
  constructShape,
  sampleDescentCurve,
  sampleCreditCurve,
  sampleEscalationLadder,
  type CurveShape,
} from '@usufruct-protocol/sdk/read/curve.js';

const PKG = '0x2';
const u64 = (v: bigint) => bcs.u64().serialize(v).toBytes();

/** A client whose simulateTransaction returns, per call, the given commandResults
 *  (each entry one u64 returnValue). */
function fakeClient(perSim: bigint[][]): { client: ClientWithCoreApi; sim: ReturnType<typeof vi.fn> } {
  let i = 0;
  const sim = vi.fn(async () => ({
    $kind: 'Transaction' as const,
    commandResults: perSim[i++]!.map((v) => ({ returnValues: [{ bcs: u64(v) }] })),
  }));
  return { client: { core: { simulateTransaction: sim } } as unknown as ClientWithCoreApi, sim };
}

const DESCENT = {
  lastAcqMist: 20_000_000_000n, phaseStartMs: 1_000n, floorMist: 10_000_000_000n,
  descentMs: 100_000n, shape: { kind: 'logistic' } as CurveShape,
};

describe('sampleDescentCurve — demux (skip the constructor command, read the views)', () => {
  it('returns one u64 per sample point, command[0] (the shape) ignored', async () => {
    const ts = [1_000n, 50_000n, 100_000n];
    // commandResults: [shape, view@t0, view@t1, view@t2]
    const { client, sim } = fakeClient([[0n, 20_000_000_000n, 15_000_000_000n, 10_000_000_000n]]);
    const out = await sampleDescentCurve(client, PKG, DESCENT, ts);
    expect(out).toEqual([20_000_000_000n, 15_000_000_000n, 10_000_000_000n]);
    expect(sim).toHaveBeenCalledTimes(1);
  });

  it('chunks >39 points into multiple simulations and concatenates', async () => {
    const ts = Array.from({ length: 41 }, (_, k) => BigInt(k));
    // chunk 1: 1 + 39 = 40 commands; chunk 2: 1 + 2 = 3 commands.
    const chunk1 = [0n, ...Array.from({ length: 39 }, (_, k) => BigInt(k))];
    const chunk2 = [0n, 39n, 40n];
    const { client, sim } = fakeClient([chunk1, chunk2]);
    const out = await sampleCreditCurve(
      client, PKG,
      { stakeMist: 1n, phaseStartMs: 0n, ceilingMs: 1n, shape: { kind: 'linear' } },
      ts,
    );
    expect(sim).toHaveBeenCalledTimes(2);
    expect(out).toHaveLength(41);
    expect(out[39]).toBe(39n);
    expect(out[40]).toBe(40n);
  });

  it('throws with the chain message on a failed simulation', async () => {
    const client = {
      core: { simulateTransaction: async () => ({ $kind: 'FailedTransaction', FailedTransaction: { status: { error: { message: 'boom' } } } }) },
    } as unknown as ClientWithCoreApi;
    await expect(sampleDescentCurve(client, PKG, DESCENT, [1_000n])).rejects.toThrow(/boom/);
  });
});

describe('sampleEscalationLadder — decode the LAST N commands (after the policy construction)', () => {
  it('reads the ladder rungs, ignoring the leading construction commands', async () => {
    // 2 construct (price, new_price_fixed_delta) + 3 ladder rungs.
    const { client } = fakeClient([[0n, 0n, 501n, 502n, 503n]]);
    const out = await sampleEscalationLadder(client, PKG, {
      startMist: 500n, tenures: 1n, escalation: { kind: 'fixedDelta', deltaMist: 1n }, steps: 3,
    });
    expect(out).toEqual([501n, 502n, 503n]);
  });
});

describe('constructShape — maps a CurveShape to its ensemble::new_* constructor', () => {
  const fn = (shape: CurveShape): string => {
    const tx = new Transaction();
    tx.add(constructShape(PKG, shape));
    const cmds = tx.getData().commands;
    const last = cmds[cmds.length - 1] as { MoveCall?: { module: string; function: string } };
    return `${last.MoveCall?.module}::${last.MoveCall?.function}`;
  };

  it('linear / smoothstep / logistic', () => {
    expect(fn({ kind: 'linear' })).toBe('ensemble::new_linear');
    expect(fn({ kind: 'smoothstep' })).toBe('ensemble::new_smoothstep');
    expect(fn({ kind: 'logistic' })).toBe('ensemble::new_logistic');
  });
  it('power_law / exponential (parameterized)', () => {
    expect(fn({ kind: 'powerLaw', alphaNum: 2, alphaDen: 1 })).toBe('ensemble::new_power_law');
    expect(fn({ kind: 'exponential', alphaAbs: 4, alphaNeg: false })).toBe('ensemble::new_exponential');
  });
});
