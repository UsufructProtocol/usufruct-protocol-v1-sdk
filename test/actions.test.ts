import { Transaction } from '@mysten/sui/transactions';
import { describe, expect, it } from 'vitest';
import * as actions from '../src/actions/index.js';
import { TESTNET } from '../src/config/network.js';
import { NotImplementedStepError } from '../src/primitives/action.js';
import { id, mist, ms, tenureCount } from '../src/primitives/brand.js';
import * as views from '../src/views/index.js';
import { ESCROW_ID, GOV_CAP_ID, idleState, occupiedState } from './synthetic.js';

const TYPE_ARGS: [string, string] = ['0xa::dummy::DummyAsset', '0x2::sui::SUI'];
const escrowId = id<'Escrow'>(ESCROW_ID);
const govCapId = id<'GovernanceCap'>(GOV_CAP_ID);

describe('integrate (Origin)', () => {
  const action = actions.integrate({
    ensemble: { restPrice: mist(1_000), tenureMs: ms(60_000) },
    assetType: TYPE_ARGS[0],
    coinType: TYPE_ARGS[1],
  });

  it('step constructs an Idle state with resolved cycle params', () => {
    const { state } = action.step(ms(5_000));
    expect(views.isIdle(state, ms(5_000))).toBe(true);
    expect(state.escrow.core?.integrated_at.ms).toBe('5000');
    const idle =
      state.escrow.state?.$kind === 'Waiting' && state.escrow.state.Waiting.$kind === 'Idle'
        ? state.escrow.state.Waiting.Idle
        : null;
    expect(idle?.cycle).toEqual({
      floor: { mist: '1000' },
      ceiling: { ms: '60000' },
      handover: { ms: '0' },
      descent: { ms: '0' },
    });
  });

  it('toPtb emits the ensemble chain plus escrow::integrate', () => {
    const tx = new Transaction();
    action.toPtb(tx, { pkg: TESTNET, asset: ESCROW_ID, typeArguments: TYPE_ARGS });
    const calls = tx
      .getData()
      .commands.filter((c) => c.$kind === 'MoveCall')
      .map((c) => `${c.MoveCall!.module}::${c.MoveCall!.function}`);
    expect(calls.at(-1)).toBe('escrow::integrate');
    expect(calls).toContain('ensemble::new_ensemble');
    expect(calls).toContain('ensemble::new_retire_commitment_immediate');
  });
});

describe('applyPendingTransitionStates (Transition)', () => {
  const action = actions.applyPendingTransitionStates();

  it('passes through when nothing is firable', () => {
    const state = occupiedState(10_000n, 60_000n);
    const { state: next, result } = action.step(state, ms(50_000));
    expect(result.transitions).toEqual([]);
    expect(next.escrow.state).toEqual(state.escrow.state);
  });

  it('fires tenure expiry then auction expiry (descent=0) → Idle', () => {
    const state = occupiedState(10_000n, 60_000n); // boundary at 70_000, descent 30_000
    const { state: next, result } = action.step(state, ms(70_000));
    // synthetic cycle has descent 30_000 → Descent until 100_000
    expect(result.transitions).toEqual(['tenureExpiry']);
    expect(views.isDescending(next, ms(70_000))).toBe(true);
    expect(views.phaseStartMs(next, ms(70_000))).toBe(70_000n);

    // a later apply crosses the descent window → Idle
    const second = action.step(next, ms(100_000));
    expect(second.result.transitions).toEqual(['auctionExpiry']);
    expect(views.isIdle(second.state, ms(100_000))).toBe(true);
  });

  it('chains: occupied → (one apply at t≥both boundaries) → Idle', () => {
    const state = occupiedState(10_000n, 60_000n);
    const { state: next, result } = action.step(state, ms(100_000));
    expect(result.transitions).toEqual(['tenureExpiry', 'auctionExpiry']);
    expect(views.isIdle(next, ms(100_000))).toBe(true);
  });

  it('toPtb targets escrow::apply_pending_transition_states', () => {
    const tx = new Transaction();
    action.toPtb(tx, { pkg: TESTNET, escrowId, typeArguments: TYPE_ARGS });
    const call = tx.getData().commands[0]?.MoveCall;
    expect(call?.function).toBe('apply_pending_transition_states');
  });
});

describe('lifecycle typing', () => {
  it('claimAsset.step returns no successor state (Terminal)', () => {
    const terminal = actions.claimAsset();
    // @ts-expect-error — TerminalAction.step result has no `state` field
    const use = () => terminal.step(idleState(), ms(0)).state;
    expect(use).toBeDefined();
  });

  it('unimplemented steps throw NotImplementedStepError', () => {
    expect(() => actions.rent({ tenures: tenureCount(1) }).step(idleState(), ms(0))).toThrow(
      NotImplementedStepError,
    );
    expect(() => actions.retire().step(idleState(), ms(0))).toThrow(NotImplementedStepError);
  });

  it('rent/retire/claim toPtb emit their target calls', () => {
    const tx = new Transaction();
    actions.rent({ tenures: tenureCount(1) }).toPtb(tx, {
      pkg: TESTNET,
      escrowId,
      payment: '0x' + '77'.repeat(32),
      typeArguments: TYPE_ARGS,
    });
    actions.retire().toPtb(tx, { pkg: TESTNET, escrowId, governanceCapId: govCapId, typeArguments: TYPE_ARGS });
    actions.claimAsset().toPtb(tx, { pkg: TESTNET, escrowId, governanceCapId: govCapId, typeArguments: TYPE_ARGS });
    const calls = tx
      .getData()
      .commands.filter((c) => c.$kind === 'MoveCall')
      .map((c) => c.MoveCall!.function);
    expect(calls).toEqual(['tenures', 'rent', 'retire', 'claim_asset']);
  });
});
