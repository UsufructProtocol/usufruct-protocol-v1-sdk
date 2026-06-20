import { describe, expect, it } from 'vitest';
import {
  reconstructStatement,
  reconstructTenancies,
} from '@usufruct-protocol/sdk/highlevel/ledger.js';
import { coinInfo } from '@usufruct-protocol/sdk/highlevel/value.js';
import type { HistoryEvent } from '@usufruct-protocol/sdk/highlevel/history.js';

const COIN = coinInfo('0x2::sui::SUI');
const CAP_A = '0x' + 'a1'.repeat(32);
const CAP_B = '0x' + 'b2'.repeat(32);
const CAP_C = '0x' + 'c3'.repeat(32);
const ADDR_A = '0x' + '11'.repeat(32);
const ADDR_B = '0x' + '22'.repeat(32);

/** A synthetic decoded event — the reconstructors read plain snake_case fields. */
const ev = (kind: string, data: Record<string, unknown>): HistoryEvent => ({
  kind,
  module: 'asset_state',
  at: null,
  by: null,
  data,
});

describe('reconstructStatement — the renter P&L', () => {
  it('rent → tenure expiry: paid is fully consumed, no refund', () => {
    const s = reconstructStatement(
      [
        ev('RentStarted', { usufruct_cap_id: CAP_A, price_paid: '500' }),
        ev('TenureExpired', { usufruct_cap_id: CAP_A, governor_share: '450', protocol_fee: '50' }),
      ],
      CAP_A,
      COIN,
    );
    expect(s.status).toBe('expired');
    expect(s.paid.mist).toBe(500n);
    expect(s.consumed.mist).toBe(500n); // governor_share + protocol_fee
    expect(s.refunded.mist).toBe(0n);
    expect(s.remaining).toBeNull();
    // the plumb-line
    expect(s.paid.mist).toBe(s.consumed.mist + s.refunded.mist);
  });

  it('rent → displaced by handover: partial consume, partial refund', () => {
    const s = reconstructStatement(
      [
        ev('RentStarted', { usufruct_cap_id: CAP_A, price_paid: '500' }),
        ev('HandoverCompleted', {
          departing_usufruct_cap_id: CAP_A,
          used_credit: '180',
          departing_refund_amount: '320',
          active_usufruct_cap_id: CAP_B,
        }),
      ],
      CAP_A,
      COIN,
    );
    expect(s.status).toBe('displaced');
    expect(s.paid.mist).toBe(500n);
    expect(s.consumed.mist).toBe(180n);
    expect(s.refunded.mist).toBe(320n);
    expect(s.paid.mist).toBe(s.consumed.mist + s.refunded.mist);
  });

  it('bid → superseded as challenger: full refund, nothing consumed', () => {
    const s = reconstructStatement(
      [
        ev('BidPlaced', { pending_usufruct_cap_id: CAP_B, pending_bid_amount: '600' }),
        ev('BidSuperseded', {
          displaced_usufruct_cap_id: CAP_B,
          refunded_amount: '600',
          pending_usufruct_cap_id: CAP_C,
          pending_bid_amount: '700',
        }),
      ],
      CAP_B,
      COIN,
    );
    expect(s.status).toBe('superseded');
    expect(s.paid.mist).toBe(600n);
    expect(s.refunded.mist).toBe(600n);
    expect(s.consumed.mist).toBe(0n);
    expect(s.paid.mist).toBe(s.consumed.mist + s.refunded.mist);
  });

  it('bid → won the handover: still active (remaining overlaid live by the handle)', () => {
    const s = reconstructStatement(
      [
        ev('BidPlaced', { pending_usufruct_cap_id: CAP_C, pending_bid_amount: '700' }),
        ev('HandoverCompleted', { active_usufruct_cap_id: CAP_C, departing_usufruct_cap_id: CAP_A }),
      ],
      CAP_C,
      COIN,
    );
    expect(s.status).toBe('active');
    expect(s.paid.mist).toBe(700n);
    expect(s.consumed.mist).toBe(0n);
    expect(s.remaining).toBeNull(); // pure projection; the cap handle overlays the live value
  });

  it('bid, not yet resolved: pending, whole stake refundable', () => {
    const s = reconstructStatement(
      [ev('BidPlaced', { pending_usufruct_cap_id: CAP_B, pending_bid_amount: '800' })],
      CAP_B,
      COIN,
    );
    expect(s.status).toBe('pending');
    expect(s.paid.mist).toBe(800n);
    expect(s.remaining?.mist).toBe(800n);
    // pending invariant: paid == consumed + refunded + remaining
    expect(s.paid.mist).toBe(s.consumed.mist + s.refunded.mist + (s.remaining?.mist ?? 0n));
  });

  it('ignores events that do not name the cap', () => {
    const s = reconstructStatement(
      [
        ev('RentStarted', { usufruct_cap_id: CAP_B, price_paid: '999' }),
        ev('TenureExpired', { usufruct_cap_id: CAP_B, governor_share: '900', protocol_fee: '99' }),
      ],
      CAP_A,
      COIN,
    );
    expect(s.paid.mist).toBe(0n);
    expect(s.consumed.mist).toBe(0n);
  });
});

describe('reconstructTenancies — the occupancy ledger', () => {
  it('rent → handover → expiry: two closed tenancies with economics', () => {
    const t = reconstructTenancies(
      [
        ev('RentStarted', {
          usufruct_cap_id: CAP_A, usufructuary_address: ADDR_A,
          price_paid: '500', ceiling_total_ms: '40000', timestamp_ms: '1000',
        }),
        ev('HandoverCompleted', {
          departing_usufruct_cap_id: CAP_A, used_credit: '180', departing_refund_amount: '320',
          governor_share: '162', protocol_fee: '18',
          active_usufruct_cap_id: CAP_B, active_usufructuary_address: ADDR_B,
          active_stake_balance: '600', ceiling_total_ms: '40000', timestamp_ms: '15000',
        }),
        ev('TenureExpired', {
          usufruct_cap_id: CAP_B, governor_share: '540', protocol_fee: '60', timestamp_ms: '55000',
        }),
      ],
      COIN,
    );
    expect(t).toHaveLength(2);

    const [alice, bob] = t;
    expect(alice!.capId).toBe(CAP_A);
    expect(alice!.usufructuary).toBe(ADDR_A);
    expect(alice!.startedAt.getTime()).toBe(1000);
    expect(alice!.endedAt?.getTime()).toBe(15000);
    expect(alice!.acquired.mist).toBe(500n);
    expect(alice!.ceilingMs).toBe(40000);
    expect(alice!.usedCredit?.mist).toBe(180n);
    expect(alice!.refund?.mist).toBe(320n);
    expect(alice!.governorShare?.mist).toBe(162n);
    expect(alice!.protocolFee?.mist).toBe(18n);

    expect(bob!.capId).toBe(CAP_B);
    expect(bob!.acquired.mist).toBe(600n); // the winning bid (active stake)
    expect(bob!.endedAt?.getTime()).toBe(55000);
    expect(bob!.usedCredit?.mist).toBe(600n); // governor_share + protocol_fee
    expect(bob!.refund?.mist).toBe(0n);
  });

  it('an ongoing tenancy has endedAt null and no settlement', () => {
    const t = reconstructTenancies(
      [
        ev('RentStarted', {
          usufruct_cap_id: CAP_A, usufructuary_address: ADDR_A,
          price_paid: '500', ceiling_total_ms: '40000', timestamp_ms: '1000',
        }),
      ],
      COIN,
    );
    expect(t).toHaveLength(1);
    expect(t[0]!.endedAt).toBeNull();
    expect(t[0]!.usedCredit).toBeNull();
    expect(t[0]!.refund).toBeNull();
  });

  it("the displaced tenancy's refund matches the renter statement", () => {
    const events = [
      ev('RentStarted', {
        usufruct_cap_id: CAP_A, usufructuary_address: ADDR_A,
        price_paid: '500', ceiling_total_ms: '40000', timestamp_ms: '1000',
      }),
      ev('HandoverCompleted', {
        departing_usufruct_cap_id: CAP_A, used_credit: '180', departing_refund_amount: '320',
        governor_share: '162', protocol_fee: '18',
        active_usufruct_cap_id: CAP_B, active_usufructuary_address: ADDR_B,
        active_stake_balance: '600', ceiling_total_ms: '40000', timestamp_ms: '15000',
      }),
    ];
    const ten = reconstructTenancies(events, COIN);
    const st = reconstructStatement(events, CAP_A, COIN);
    expect(ten[0]!.refund!.mist).toBe(st.refunded.mist);
    expect(ten[0]!.usedCredit!.mist).toBe(st.consumed.mist);
  });
});
