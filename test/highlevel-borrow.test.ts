import { Transaction } from '@mysten/sui/transactions';
import { describe, expect, it } from 'vitest';
import { createCap } from '@usufruct-protocol/sdk/highlevel/cap.js';
import type { Use } from '@usufruct-protocol/sdk';
import { TESTNET } from '@usufruct-protocol/sdk/config/network.js';

// Plan.build only needs the deployment to assemble the bracket — no client/signer.
const ctx = {
  client: {} as never,
  packageId: TESTNET.packageId,
  feeRefId: '',
  account: null,
  defaultExecutor: null,
} as never;

const cap = createCap(ctx, {
  capId: '0x1',
  escrowId: '0x2',
  typeArguments: ['0xaaa::dummy::DummyAsset', '0x2::sui::SUI'],
  receipt: null,
});

const call = (fn: string): Use => (asset, tx) => {
  tx.moveCall({ target: `0xaaa::recipe::${fn}`, arguments: [asset] });
};

const moveCalls = (tx: Transaction): string[] =>
  tx
    .getData()
    .commands.filter((c) => c.$kind === 'MoveCall')
    .map((c) => c.MoveCall!.function);

// borrow(...uses) is a Plan; .build(tx, sender) appends the bracket to a tx you drive.
const SENDER = '0x0000000000000000000000000000000000000000000000000000000000000abc';

describe('cap.borrow — variadic composition (Plan.build)', () => {
  it('composes several Use middles in order, inside one borrow→return bracket', async () => {
    const tx = new Transaction();
    await cap.write.borrow(call('a'), call('b'), call('c')).build(tx, SENDER);
    expect(moveCalls(tx)).toEqual(['borrow_asset', 'a', 'b', 'c', 'return_asset']);
  });

  it('a single Use is the same call shape', async () => {
    const tx = new Transaction();
    await cap.write.borrow(call('solo')).build(tx, SENDER);
    expect(moveCalls(tx)).toEqual(['borrow_asset', 'solo', 'return_asset']);
  });

  it('repeating a step repeats its commands, in order', async () => {
    const tx = new Transaction();
    await cap.write.borrow(call('read'), call('use'), call('use'), call('use')).build(tx, SENDER);
    expect(moveCalls(tx)).toEqual(['borrow_asset', 'read', 'use', 'use', 'use', 'return_asset']);
  });

  it('threads the same asset handle to every step', async () => {
    const tx = new Transaction();
    const seen: unknown[] = [];
    const spy: Use = (asset) => void seen.push(asset);
    await cap.write.borrow(spy, spy).build(tx, SENDER);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
  });

  it('no steps still produces a well-formed (empty) bracket', async () => {
    const tx = new Transaction();
    await cap.write.borrow().build(tx, SENDER);
    expect(moveCalls(tx)).toEqual(['borrow_asset', 'return_asset']);
  });
});
