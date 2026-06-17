import { describe, expect, it } from 'vitest';
import { ms } from '@usufruct-protocol/sdk/primitives/brand.js';
import * as views from '@usufruct-protocol/sim/views/index.js';
import {
  BIDDER,
  BIDDER_CAP,
  GOV_CAP_ID,
  INBOX_ID,
  FEE_INBOX,
  TENANT_CAP,
  demandState,
  idleState,
  occupiedState,
} from './synthetic.js';

const t0 = ms(0);

describe('seat views', () => {
  const idle = idleState();
  const occupied = occupiedState(10_000n);
  const demand = demandState(10_000n, 70_000n);

  it('active seat: cap id, stake, tenures', () => {
    expect(views.activeUsufructCapId(idle, t0)).toBeNull();
    expect(views.activeUsufructCapId(occupied, t0)).toBe(TENANT_CAP);
    expect(views.activeStakeBalanceMist(occupied, t0)).toBe(1_000n);
    expect(views.activeCommittedTenures(occupied, t0)).toBe(1n);
    // Demand keeps the active seat visible too.
    expect(views.activeUsufructCapId(demand, t0)).toBe(TENANT_CAP);
  });

  it('pending seat only exists in Demand', () => {
    expect(views.pendingUsufructuaryAddr(occupied, t0)).toBeNull();
    expect(views.pendingUsufructCapId(occupied, t0)).toBeNull();
    expect(views.pendingStakeBalanceMist(occupied, t0)).toBeNull();
    expect(views.pendingCommittedTenures(occupied, t0)).toBeNull();

    expect(views.pendingUsufructuaryAddr(demand, t0)).toBe(BIDDER);
    expect(views.pendingUsufructCapId(demand, t0)).toBe(BIDDER_CAP);
    expect(views.pendingStakeBalanceMist(demand, t0)).toBe(2_000n);
    expect(views.pendingCommittedTenures(demand, t0)).toBe(2n);
  });

  it('isRetiring reads the occupied terms flag', () => {
    expect(views.isRetiring(idle, t0)).toBe(false);
    expect(views.isRetiring(occupied, t0)).toBe(false);
  });

  it('inbox ids from core', () => {
    expect(views.earningsInboxId(idle, t0)).toBe(INBOX_ID);
    expect(views.feeInboxId(idle, t0)).toBe(FEE_INBOX);
  });

  it('cap verification factories mirror cap_is_active/_is_pending/_is_stale', () => {
    expect(views.governanceCapIsValid(GOV_CAP_ID)(idle, t0)).toBe(true);
    expect(views.governanceCapIsValid(BIDDER_CAP)(idle, t0)).toBe(false);

    expect(views.usufructCapIsActive(TENANT_CAP)(demand, t0)).toBe(true);
    expect(views.usufructCapIsPending(BIDDER_CAP)(demand, t0)).toBe(true);
    expect(views.usufructCapIsPending(TENANT_CAP)(demand, t0)).toBe(false);

    expect(views.usufructCapIsStale(TENANT_CAP)(demand, t0)).toBe(false);
    expect(views.usufructCapIsStale(BIDDER_CAP)(demand, t0)).toBe(false);
    expect(views.usufructCapIsStale(GOV_CAP_ID)(demand, t0)).toBe(true);
    // Any cap is stale on an idle escrow.
    expect(views.usufructCapIsStale(TENANT_CAP)(idle, t0)).toBe(true);
  });

  it('type names use the canonical Move type_name form', () => {
    // No 0x prefix, address padded to 64 hex chars, struct case preserved.
    expect(views.coinTypeName(idle, t0)).toBe('0'.repeat(63) + '2::sui::SUI');
    expect(views.assetTypeName(idle, t0)).toBe(
      '0'.repeat(63) + 'a::dummy::DummyAsset',
    );
  });
});
