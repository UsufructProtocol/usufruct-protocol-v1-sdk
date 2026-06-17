import { Transaction } from '@mysten/sui/transactions';
import { describe, expect, it } from 'vitest';
import * as actions from '../src/sim/actions/index.js';
import { TESTNET } from '../src/config/network.js';
import { id, mist, ms, tenureCount } from '../src/primitives/brand.js';
import * as views from '../src/views/index.js';
import {
  ESCROW_ID,
  GOV_CAP_ID,
  TENANT,
  demandState,
  idleState,
  occupiedState,
} from './synthetic.js';

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
    // Full stake (1000) consumed, no refund, split 90/10 — no handover settlement.
    expect(result.tenureSettlement).toEqual({
      usedMist: 1_000n,
      governorShareMist: 900n,
      feeMist: 100n,
    });
    expect(result.tenureSettlement!.governorShareMist + result.tenureSettlement!.feeMist).toBe(
      result.tenureSettlement!.usedMist,
    );
    expect(result.settlement).toBeUndefined();
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

  it('multi-tenure: settles the FULL stake, prices the next auction per-tenure', () => {
    // committed 2, total stake 2000 (= floor 1000 × 2). boundary at 60_000.
    const state = occupiedState(0n, 60_000n, { committed: 2n, stakeMist: 2_000n });
    const { state: next, result } = action.step(state, ms(60_000));
    expect(result.transitions).toContain('tenureExpiry');
    // The settlement is the full (total) stake split 90/10 — NOT per-tenure.
    expect(result.tenureSettlement).toEqual({
      usedMist: 2_000n,
      governorShareMist: 1_800n,
      feeMist: 200n,
    });
    // The Descent's starting price *is* per-tenure: 2000 / 2 = 1000.
    const descent =
      next.escrow.state?.$kind === 'Waiting' && next.escrow.state.Waiting.$kind === 'Descent'
        ? next.escrow.state.Waiting.Descent
        : null;
    expect(BigInt(descent!.auction.last_acq_price.mist)).toBe(1_000n);
  });

  it('toPtb targets escrow::apply_pending_transition_states', () => {
    const tx = new Transaction();
    action.toPtb(tx, { pkg: TESTNET, escrowId, typeArguments: TYPE_ARGS });
    const call = tx.getData().commands[0]?.MoveCall;
    expect(call?.function).toBe('apply_pending_transition_states');
  });
});

describe('apply.step handover (curve settlement)', () => {
  // demandState: active stake 1000, pending 2000, phase_start 10_000,
  // ceiling 60_000, committed 1, bid tenures 2, expiry 70_000, linear credit.
  it('settles via the credit curve and swaps pending → active', () => {
    const demand = demandState(10_000n, 70_000n, 60_000n);
    const { state, result } = actions
      .applyPendingTransitionStates()
      .step(demand, ms(70_000));

    expect(result.transitions).toContain('handover');
    // elapsed = ceiling ⇒ credit height = SCALE ⇒ used = full principal 1000.
    expect(result.settlement).toEqual({
      usedMist: 1_000n,
      governorShareMist: 900n,
      feeMist: 100n,
      refundMist: 0n,
      newRentPriceMist: 1_001n, // ascending floor: 2000/2 + fixedDelta 1
    });
    expect(views.isOccupied(state, ms(70_000))).toBe(true);
    expect(views.activeStakeBalanceMist(state, ms(70_000))).toBe(2_000n);
    // schedule rescaled by tenure ratio 1 → 2.
    expect(views.activeCeilingTotalMs(state, ms(70_000))).toBe(120_000n);
  });

  it('does not fire before the handover expiry', () => {
    const demand = demandState(10_000n, 70_000n, 60_000n);
    const { result } = actions.applyPendingTransitionStates().step(demand, ms(50_000));
    expect(result.transitions).toEqual([]);
    expect(result.settlement).toBeUndefined();
  });

  it('multi-tenure: credit over the full stake; new price per incoming tenure', () => {
    // active committed 2 / stake 2000; incoming bid: 3 tenures / pending 3000.
    const demand = demandState(10_000n, 70_000n, 60_000n, {
      committed: 2n,
      stakeMist: 2_000n,
      pendingMist: 3_000n,
      incoming: 3n,
    });
    const { result } = actions.applyPendingTransitionStates().step(demand, ms(70_000));
    expect(result.transitions).toContain('handover');
    // elapsed == ceiling ⇒ used = full active stake 2000 (total, not per-tenure).
    expect(result.settlement!.usedMist).toBe(2_000n);
    expect(result.settlement!.governorShareMist).toBe(1_800n);
    expect(result.settlement!.feeMist).toBe(200n);
    expect(result.settlement!.refundMist).toBe(0n);
    // new price is per incoming tenure: stakePerTenure(3000, 3) = 1000, + delta 1.
    expect(result.settlement!.newRentPriceMist).toBe(1_001n);
  });
});

describe('lifecycle typing', () => {
  it('claimAsset.step returns no successor state (Terminal)', () => {
    const terminal = actions.claimAsset();
    // @ts-expect-error — TerminalAction.step result has no `state` field
    const use = () => terminal.step(idleState(), ms(0)).state;
    expect(use).toBeDefined();
  });

  it('rent.step over Idle installs (curve floor = rest price)', () => {
    const { state, result } = actions
      .rent({ tenures: tenureCount(1), paymentMist: mist(1_000), sender: TENANT })
      .step(idleState(), ms(5_000));
    expect(result.transition).toBe('install');
    expect(result.floorMist).toBe(1_000n);
    expect(views.isOccupied(state, ms(5_000))).toBe(true);
    expect(views.activeStakeBalanceMist(state, ms(5_000))).toBe(1_000n);
  });

  it('rent.step rejects underpayment (EInsufficientPayment)', () => {
    expect(() =>
      actions
        .rent({ tenures: tenureCount(1), paymentMist: mist(999) })
        .step(idleState(), ms(5_000)),
    ).toThrow(/EInsufficientPayment/);
  });

  it('retire.step over Idle retires immediately (commitment elapsed)', () => {
    const { state } = actions.retire().step(idleState(), ms(5_000));
    expect(views.isRetired(state, ms(5_000))).toBe(true);
  });

  it('retire.step guards the retire commitment', () => {
    // synthetic anchor = 1_000, Immediate → unlocks at 1_000; t=500 too early.
    expect(() => actions.retire().step(idleState(), ms(500))).toThrow(
      /ERetireCommitmentFloorNotElapsed/,
    );
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
