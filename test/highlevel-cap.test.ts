import type { ClientWithCoreApi } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { describe, expect, it } from 'vitest';
import { createCap } from '../src/highlevel/cap.js';
import { NotConnected } from '../src/highlevel/errors.js';
import type { Source } from '../src/highlevel/../primitives/source.js';

const hex = (b: string) => '0x' + b.repeat(32);
const PKG = hex('33');
const ARGS = {
  capId: hex('11'),
  escrowId: hex('22'),
  typeArguments: [`${hex('aa')}::a::A`, '0x2::sui::SUI'] as [string, string],
  receipt: null,
};
const noClient = {} as ClientWithCoreApi;
const noSource = {} as unknown as Source;

describe('highlevel/cap — UsufructCap handle', () => {
  it('wires id / escrowId / receipt and a back-edge', () => {
    const cap = createCap(noClient, PKG, noSource, null, ARGS);
    expect(cap.id).toBe(ARGS.capId);
    expect(cap.escrowId).toBe(ARGS.escrowId);
    expect(cap.receipt).toBeNull();
    expect(typeof cap.escrow).toBe('function');
    expect(typeof cap.borrow).toBe('function');
    expect(typeof cap.borrow.into).toBe('function');
  });

  it('borrow without a signer throws NotConnected', () => {
    const cap = createCap(noClient, PKG, noSource, null, ARGS);
    expect(() => cap.borrow(() => {})).toThrow(NotConnected);
  });

  it('borrow.into appends a borrow→return bracket into a caller-driven PTB', () => {
    const cap = createCap(noClient, PKG, noSource, null, ARGS);
    const tx = new Transaction();
    let sawAsset = false;
    cap.borrow.into(tx, (asset) => {
      sawAsset = asset != null; // the user's middle receives the asset handle
    });
    expect(sawAsset).toBe(true);
    // borrow + return are both appended (plus whatever the middle adds — none here).
    const commands = tx.getData().commands;
    expect(commands.length).toBeGreaterThanOrEqual(2);
  });
});
