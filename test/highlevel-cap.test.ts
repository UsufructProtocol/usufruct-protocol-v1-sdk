import type { ClientWithCoreApi } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { describe, expect, it } from 'vitest';
import { createCap } from '../src/highlevel/cap.js';
import type { HandleCtx } from '../src/highlevel/ctx.js';
import { NotConnected } from '../src/highlevel/errors.js';

const hex = (b: string) => '0x' + b.repeat(32);
const PKG = hex('33');
const ARGS = {
  capId: hex('11'),
  escrowId: hex('22'),
  typeArguments: [`${hex('aa')}::a::A`, '0x2::sui::SUI'] as [string, string],
  receipt: null,
};
const ctx: HandleCtx = {
  client: {} as ClientWithCoreApi,
  packageId: PKG,
  signer: null,
};

describe('highlevel/cap — UsufructCap handle', () => {
  it('wires id / escrowId / receipt and a back-edge', () => {
    const cap = createCap(ctx, ARGS);
    expect(cap.id).toBe(ARGS.capId);
    expect(cap.escrowId).toBe(ARGS.escrowId);
    expect(cap.receipt).toBeNull();
    expect(typeof cap.escrow).toBe('function');
    expect(typeof cap.borrow).toBe('function');
    expect(typeof cap.borrow.into).toBe('function');
  });

  it('borrow without a signer throws NotConnected', () => {
    const cap = createCap(ctx, ARGS);
    expect(() => cap.borrow(() => {})).toThrow(NotConnected);
  });

  it('exposes the cap-holder write surface (object, not role)', () => {
    const cap = createCap(ctx, ARGS);
    for (const m of ['transfer', 'burnIfStale', 'burn', 'updateRefundAddress'] as const) {
      expect(typeof cap[m]).toBe('function');
    }
  });

  it('cap-holder writes need a signer (you must hold the cap)', async () => {
    const cap = createCap(ctx, ARGS);
    await expect(cap.burnIfStale()).rejects.toBeInstanceOf(NotConnected);
    await expect(cap.burn()).rejects.toBeInstanceOf(NotConnected);
    await expect(cap.updateRefundAddress(hex('cc'))).rejects.toBeInstanceOf(NotConnected);
    await expect(cap.transfer(hex('cc'))).rejects.toBeInstanceOf(NotConnected);
  });

  it('borrow.into appends a borrow→return bracket into a caller-driven PTB', () => {
    const cap = createCap(ctx, ARGS);
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
