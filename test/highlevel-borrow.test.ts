import { Transaction } from '@mysten/sui/transactions';
import { describe, expect, it } from 'vitest';
import { createCap } from '@usufruct-protocol/sdk/highlevel/cap.js';
import type { Use } from '@usufruct-protocol/sdk';
import { TESTNET } from '@usufruct-protocol/sdk/config/network.js';

// `borrow.into` only needs the deployment to build the bracket — no client/signer.
const ctx = {
  client: {} as never,
  packageId: TESTNET.packageId,
  feeRefId: '',
  signer: null,
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

describe('cap.borrow — variadic composition', () => {
  it('composes several Use middles in order, inside one borrow→return bracket', () => {
    const tx = new Transaction();
    cap.borrow.into(tx, call('a'), call('b'), call('c'));
    expect(moveCalls(tx)).toEqual(['borrow_asset', 'a', 'b', 'c', 'return_asset']);
  });

  it('a single Use is the same call shape', () => {
    const tx = new Transaction();
    cap.borrow.into(tx, call('solo'));
    expect(moveCalls(tx)).toEqual(['borrow_asset', 'solo', 'return_asset']);
  });

  it('repeating a step repeats its commands, in order', () => {
    const tx = new Transaction();
    cap.borrow.into(tx, call('read'), call('use'), call('use'), call('use'));
    expect(moveCalls(tx)).toEqual([
      'borrow_asset',
      'read',
      'use',
      'use',
      'use',
      'return_asset',
    ]);
  });

  it('threads the same asset handle to every step', () => {
    const tx = new Transaction();
    const seen: unknown[] = [];
    const spy: Use = (asset) => void seen.push(asset);
    cap.borrow.into(tx, spy, spy);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
  });

  it('no steps still produces a well-formed (empty) bracket', () => {
    const tx = new Transaction();
    cap.borrow.into(tx);
    expect(moveCalls(tx)).toEqual(['borrow_asset', 'return_asset']);
  });
});
