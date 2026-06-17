import type { ClientWithCoreApi } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { describe, expect, it } from 'vitest';
import { usufruct } from '@usufruct-protocol/sdk';
import { makePlan } from '@usufruct-protocol/sdk/highlevel/plan.js';
import type { ExecResult } from '@usufruct-protocol/sdk/highlevel/send.js';

// A session with a stub client — batch never touches it until .send().
const u = usufruct({ client: {} as ClientWithCoreApi });

// A stub write Plan: appends one moveCall in build, returns `value` in decode.
const stub = <T>(fn: string, value: T) =>
  makePlan<T>({
    defaultExecutor: () => null,
    build: async (tx) => {
      tx.moveCall({ target: `0xaaa::m::${fn}`, arguments: [] });
    },
    decode: async () => value,
  });

const moveCalls = (tx: Transaction): string[] =>
  tx
    .getData()
    .commands.filter((c) => c.$kind === 'MoveCall')
    .map((c) => c.MoveCall!.function);

describe('u.batch — compose write Plans into one tx', () => {
  it('builds every plan into one tx, in order', async () => {
    const tx = new Transaction();
    await u.batch(stub('a', 1), stub('b', 2), stub('c', 3)).build(tx, '0xabc');
    expect(moveCalls(tx)).toEqual(['a', 'b', 'c']);
  });

  it('decodes to a typed tuple, in order', async () => {
    const result = await u.batch(stub('a', 'A'), stub('b', 42)).decode({} as ExecResult);
    expect(result).toEqual(['A', 42]);
  });

  it('a batch is itself a Plan (has send / build / toTransaction)', () => {
    const b = u.batch(stub('a', 1));
    expect(typeof b.send).toBe('function');
    expect(typeof b.build).toBe('function');
    expect(typeof b.toTransaction).toBe('function');
  });

  it('an empty batch builds nothing and decodes to []', async () => {
    const tx = new Transaction();
    await u.batch().build(tx, '0xabc');
    expect(moveCalls(tx)).toEqual([]);
    expect(await u.batch().decode({} as ExecResult)).toEqual([]);
  });
});
