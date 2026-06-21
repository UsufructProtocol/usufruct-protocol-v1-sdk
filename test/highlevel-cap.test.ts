import type { ClientWithCoreApi } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { describe, expect, it } from 'vitest';
import { createCap } from '@usufruct-protocol/sdk/highlevel/cap.js';
import type { HandleCtx } from '@usufruct-protocol/sdk/highlevel/ctx.js';
import { NotConnected } from '@usufruct-protocol/sdk/highlevel/errors.js';

const hex = (b: string) => '0x' + b.repeat(32);
const PKG = hex('33');
const ARGS = {
  capId: hex('11'),
  escrowId: hex('22'),
  typeArguments: [`${hex('aa')}::a::A`, '0x2::sui::SUI'] as [string, string],
  receipt: null,
};
// No identity, no executor — a read-only/anonymous context.
const ctx: HandleCtx = {
  client: {} as ClientWithCoreApi,
  packageId: PKG,
  feeRefId: '',
  account: null,
  defaultExecutor: null,
  signer: null,
};

describe('highlevel/cap — UsufructCap handle', () => {
  it('wires id / escrowId / receipt and a back-edge', () => {
    const cap = createCap(ctx, ARGS);
    expect(cap.id).toBe(ARGS.capId);
    expect(cap.escrowId).toBe(ARGS.escrowId);
    expect(cap.receipt).toBeNull();
    expect(typeof cap.nav.escrow).toBe('function');
    expect(typeof cap.write.borrow).toBe('function');
  });

  it('borrow builds a Plan; .send() without an executor rejects NotConnected', async () => {
    const cap = createCap(ctx, ARGS);
    const plan = cap.write.borrow(() => {});
    expect(typeof plan.send).toBe('function');
    expect(typeof plan.build).toBe('function');
    await expect(plan.send()).rejects.toBeInstanceOf(NotConnected);
  });

  it('exposes the cap-holder write surface (object, not role)', () => {
    const cap = createCap(ctx, ARGS);
    for (const m of ['transfer', 'burnIfStale', 'burn', 'updateRefundAddress'] as const) {
      expect(typeof cap.write[m]).toBe('function');
    }
  });

  it('cap-holder write Plans need an executor (you must hold the cap)', async () => {
    const cap = createCap(ctx, ARGS);
    await expect(cap.write.burn().send()).rejects.toBeInstanceOf(NotConnected);
    await expect(cap.write.updateRefundAddress(hex('cc')).send()).rejects.toBeInstanceOf(NotConnected);
    await expect(cap.write.transfer(hex('cc')).send()).rejects.toBeInstanceOf(NotConnected);
  });

  it('borrow(...).build appends a borrow→return bracket into a caller-driven PTB', async () => {
    const cap = createCap(ctx, ARGS);
    const tx = new Transaction();
    let sawAsset = false;
    await cap.write
      .borrow((asset) => {
        sawAsset = asset != null; // the user's middle receives the asset handle
      })
      .build(tx, hex('cc'));
    expect(sawAsset).toBe(true);
    // borrow + return are both appended (plus whatever the middle adds — none here).
    expect(tx.getData().commands.length).toBeGreaterThanOrEqual(2);
  });
});
