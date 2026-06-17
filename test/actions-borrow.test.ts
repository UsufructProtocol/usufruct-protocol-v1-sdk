import { Transaction } from '@mysten/sui/transactions';
import { describe, expect, it } from 'vitest';
import * as actions from '@usufruct-protocol/sim/sim/actions/index.js';
import { TESTNET } from '@usufruct-protocol/sdk/config/network.js';
import { id, ms } from '@usufruct-protocol/sdk/primitives/brand.js';
import { BIDDER_CAP, ESCROW_ID, TENANT_CAP, idleState, occupiedState } from './synthetic.js';
import { stable } from './parity-cases.js';

const TYPE_ARGS: [string, string] = ['0xa::dummy::DummyAsset', '0x2::sui::SUI'];
const escrowId = id<'Escrow'>(ESCROW_ID);
const t0 = ms(0);

describe('borrowAsset / returnAsset pair', () => {
  it('borrow ∘ return is the identity on a settled Occupied state', () => {
    const state = occupiedState(10_000n, 60_000n);
    const borrow = actions.borrowAsset({ usufructCapId: TENANT_CAP });

    const { state: borrowed, result } = borrow.step(state, t0);
    expect(borrowed.escrow.state).toBeNull();
    expect(result.receipt.assetId).toBeDefined();
    // The receipt carries the drained renting state.
    const custody =
      result.receipt.renting.$kind === 'Occupied'
        ? result.receipt.renting.Occupied.asset
        : null;
    expect(custody?.available).toBeNull();

    const { state: restored } = actions.returnAsset(result.receipt).step(borrowed, t0);
    expect(stable(restored.escrow)).toBe(stable(state.escrow));
  });

  it('borrow guards: idle escrow and non-active cap throw', () => {
    expect(() =>
      actions.borrowAsset({ usufructCapId: TENANT_CAP }).step(idleState(), t0),
    ).toThrow(/EStaleUsufructCap/);
    expect(() =>
      actions.borrowAsset({ usufructCapId: BIDDER_CAP }).step(occupiedState(0n), t0),
    ).toThrow(/EStaleUsufructCap/);
  });

  it('borrow applies pending transitions first (tenure already expired → not rented)', () => {
    const state = occupiedState(10_000n, 60_000n); // boundary 70_000, descent 30_000
    // At t=100_000 both transitions fire → Idle → borrow must reject.
    expect(() =>
      actions.borrowAsset({ usufructCapId: TENANT_CAP }).step(state, ms(100_000)),
    ).toThrow(/EStaleUsufructCap/);
  });

  it('withBorrowedAsset brackets user commands between borrow and return', () => {
    const tx = new Transaction();
    const out = actions.withBorrowedAsset(
      tx,
      { pkg: TESTNET, escrowId, usufructCapId: TENANT_CAP, typeArguments: TYPE_ARGS },
      (asset) => {
        tx.moveCall({ target: '0xaaa::game::play', arguments: [asset] });
        return 'artifact';
      },
    );
    expect(out).toBe('artifact');
    const calls = tx
      .getData()
      .commands.filter((c) => c.$kind === 'MoveCall')
      .map((c) => c.MoveCall!.function);
    expect(calls).toEqual(['borrow_asset', 'play', 'return_asset']);
  });

  it('withBorrowedAssetStep: identity when use leaves the asset untouched', () => {
    const state = occupiedState(10_000n, 60_000n);
    const { state: restored, result } = actions.withBorrowedAssetStep(
      state,
      t0,
      TENANT_CAP,
      (asset) => ({ asset, result: 42 }),
    );
    expect(result).toBe(42);
    expect(stable(restored.escrow)).toBe(stable(state.escrow));
  });

  it('withBorrowedAssetStep: models a foreign mutation of the asset', () => {
    const state = occupiedState(10_000n, 60_000n);
    type Dummy = { id: string; uses: string };
    const { state: restored } = actions.withBorrowedAssetStep<Dummy, null>(
      state,
      t0,
      TENANT_CAP,
      (asset) => ({
        asset: { ...asset, uses: String(BigInt(asset.uses ?? '0') + 1n) },
        result: null,
      }),
    );
    const s = restored.escrow.state;
    const custody =
      s?.$kind === 'Renting' && s.Renting.$kind === 'Occupied' ? s.Renting.Occupied.asset : null;
    expect((custody?.available as Dummy).uses).toBe('1');
    expect(stable(restored.escrow)).not.toBe(stable(state.escrow));
  });

  it('toPtb emits borrow then return in one PTB', () => {
    const tx = new Transaction();
    const borrowed = actions.borrowAsset({ usufructCapId: TENANT_CAP }).toPtb(tx, {
      pkg: TESTNET,
      escrowId,
      usufructCapId: TENANT_CAP,
      typeArguments: TYPE_ARGS,
    });
    actions
      .returnAsset({} as never) // receipt value unused by toPtb
      .toPtb(tx, {
        pkg: TESTNET,
        escrowId,
        asset: borrowed[0]!,
        receipt: borrowed[1]!,
        typeArguments: TYPE_ARGS,
      });
    const calls = tx
      .getData()
      .commands.filter((c) => c.$kind === 'MoveCall')
      .map((c) => c.MoveCall!.function);
    expect(calls).toEqual(['borrow_asset', 'return_asset']);
  });
});
