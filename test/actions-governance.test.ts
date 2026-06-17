import { Transaction } from '@mysten/sui/transactions';
import { describe, expect, it } from 'vitest';
import * as actions from '@usufruct-protocol/sim/sim/actions/index.js';
import { TESTNET } from '@usufruct-protocol/sdk/config/network.js';
import { id, mist, ms } from '@usufruct-protocol/sdk/primitives/brand.js';
import * as views from '@usufruct-protocol/sim/views/index.js';
import {
  BIDDER,
  BIDDER_CAP,
  ESCROW_ID,
  GOV_CAP_ID,
  TENANT_CAP,
  demandState,
  idleState,
  occupiedState,
  retiredState,
} from './synthetic.js';

const escrowId = id<'Escrow'>(ESCROW_ID);
const govCapId = id<'GovernanceCap'>(GOV_CAP_ID);
const TYPE_ARGS: [string, string] = ['0xa::dummy::DummyAsset', '0x2::sui::SUI'];
const t0 = ms(0);

describe('commitment extensions', () => {
  it('chains the anchor to the old unlock timestamp', () => {
    // synthetic: anchor=1_000, Immediate → old unlock = 1_000
    const { state } = actions
      .extendRetireCommitment({ kind: 'deferred', floorMs: ms(60_000) })
      .step(idleState(), t0);
    expect(views.retireCommitmentAnchorMs(state, t0)).toBe(1_000n);
    expect(views.retireCommitmentUnlocksAtMs(state, t0)).toBe(61_000n);

    // extending again chains from 61_000
    const second = actions
      .extendEnsembleCommitment({ kind: 'deferred', floorMs: ms(5_000) })
      .step(state, t0).state;
    expect(views.ensembleCommitmentUnlocksAtMs(second, t0)).toBe(6_000n);
  });

  it('guards: zero duration and retired state', () => {
    expect(() =>
      actions.extendRetireCommitment({ kind: 'immediate' }).step(idleState(), t0),
    ).toThrow(/NotExtended/);
    expect(() =>
      actions
        .extendRetireCommitment({ kind: 'deferred', floorMs: ms(1) })
        .step(retiredState(), t0),
    ).toThrow(/EAlreadyRetired/);
  });
});

describe('updateEnsemble', () => {
  const newCfg = { restPrice: mist(2_000), tenureMs: ms(40_000) };

  it('applies immediately on Idle (active + cycle re-resolved)', () => {
    const { state, result } = actions.updateEnsemble(newCfg).step(idleState(), ms(2_000));
    expect(result.applied).toBe('immediate');
    expect(views.restPrice(state, t0)).toEqual({ kind: 'fixed', priceMist: 2_000n });
    expect(views.nextCycleParams(state, t0)?.floorMist).toBe(2_000n);
    expect(views.hasPendingEnsembleUpdate(state, t0)).toBe(false);
  });

  it('schedules on Occupied (pending set, active untouched)', () => {
    const { state, result } = actions
      .updateEnsemble(newCfg)
      .step(occupiedState(10_000n), ms(20_000));
    expect(result.applied).toBe('scheduled');
    expect(views.hasPendingEnsembleUpdate(state, ms(0))).toBe(true);
    expect(views.restPrice(state, t0)).toEqual({ kind: 'fixed', priceMist: 1_000n });
    expect(views.pendingCycleParams(state, t0)?.floorMist).toBe(2_000n);
  });

  it('guard: commitment not elapsed throws', () => {
    // anchor=1_000 Immediate → elapsed at t≥1_000; t=500 not elapsed.
    expect(() => actions.updateEnsemble(newCfg).step(idleState(), ms(500))).toThrow(
      /EEnsembleCommitmentFloorNotElapsed/,
    );
  });
});

describe('updateUsufructuaryRefundAddress', () => {
  const NEW = '0x' + 'ee'.repeat(32);

  it('updates the seat matching the cap (active vs pending)', () => {
    const demand = demandState(0n, 70_000n);
    const viaActive = actions
      .updateUsufructuaryRefundAddress({ usufructCapId: TENANT_CAP, newAddress: NEW })
      .step(demand, t0).state;
    expect(views.activeUsufructuaryAddr(viaActive, t0)).toBe(NEW);
    expect(views.pendingUsufructuaryAddr(viaActive, t0)).toBe(BIDDER);

    const viaPending = actions
      .updateUsufructuaryRefundAddress({ usufructCapId: BIDDER_CAP, newAddress: NEW })
      .step(demand, t0).state;
    expect(views.pendingUsufructuaryAddr(viaPending, t0)).toBe(NEW);
  });

  it('stale cap throws', () => {
    expect(() =>
      actions
        .updateUsufructuaryRefundAddress({ usufructCapId: GOV_CAP_ID, newAddress: NEW })
        .step(occupiedState(0n), t0),
    ).toThrow(/EUsufructCapStale/);
  });
});

describe('burnStaleUsufructCap', () => {
  it('rejects active/pending caps, passes stale ones, leaves state intact', () => {
    const demand = demandState(0n, 70_000n);
    expect(() =>
      actions.burnStaleUsufructCap({ usufructCapId: TENANT_CAP }).step(demand, t0),
    ).toThrow(/EUsufructCapNotStale/);
    expect(() =>
      actions.burnStaleUsufructCap({ usufructCapId: BIDDER_CAP }).step(demand, t0),
    ).toThrow(/EUsufructCapNotStale/);
    const { state } = actions
      .burnStaleUsufructCap({ usufructCapId: GOV_CAP_ID })
      .step(demand, t0);
    expect(state.escrow.state).toEqual(demand.escrow.state);
  });
});

describe('toPtb shapes', () => {
  it('governance actions emit their target calls', () => {
    const tx = new Transaction();
    const args = { pkg: TESTNET, escrowId, governanceCapId: govCapId, typeArguments: TYPE_ARGS };
    actions.extendRetireCommitment({ kind: 'deferred', floorMs: ms(1_000) }).toPtb(tx, args);
    actions.extendEnsembleCommitment({ kind: 'deferred', floorMs: ms(1_000) }).toPtb(tx, args);
    actions.updateEnsemble({ restPrice: mist(1), tenureMs: ms(1) }).toPtb(tx, args);
    actions
      .updateUsufructuaryRefundAddress({ usufructCapId: TENANT_CAP, newAddress: ESCROW_ID })
      .toPtb(tx, { pkg: TESTNET, escrowId, usufructCapId: TENANT_CAP, typeArguments: TYPE_ARGS });
    actions
      .burnStaleUsufructCap({ usufructCapId: TENANT_CAP })
      .toPtb(tx, { pkg: TESTNET, escrowId, usufructCapId: TENANT_CAP, typeArguments: TYPE_ARGS });
    actions.renounceGovernanceToPtb(tx, { pkg: TESTNET, governanceCapId: govCapId });
    actions.burnUsufructCapToPtb(tx, { pkg: TESTNET, usufructCapId: TENANT_CAP });

    const calls = tx
      .getData()
      .commands.filter((c) => c.$kind === 'MoveCall')
      .map((c) => c.MoveCall!.function);
    for (const fn of [
      'extend_retire_commitment',
      'extend_ensemble_commitment',
      'update_ensemble',
      'refund_address',
      'update_usufructuary_refund_address',
      'burn_stale_usufruct_cap',
      'renounce_governance',
      'burn_usufruct_cap',
    ]) {
      expect(calls).toContain(fn);
    }
  });
});
