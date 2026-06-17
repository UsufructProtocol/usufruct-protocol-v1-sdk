/**
 * Offline memoryInbox: coin-polymorphic partition + collect, and the escrow ↔
 * inbox 90/10 economy closed entirely in RAM (no network) — the conservation
 * the live e2e proves (collected == posted), here as an offline assertion.
 */
import { describe, expect, it } from 'vitest';
import * as actions from '@usufruct-protocol/sim/sim/actions/index.js';
import { id, mist, ms } from '@usufruct-protocol/sdk/primitives/brand.js';
import { memoryInbox, postSettlement } from '@usufruct-protocol/sim/primitives/memory-inbox.js';
import { memorySource } from '@usufruct-protocol/sim/primitives/memory-source.js';
import { ESCROW_ID, demandState, occupiedState } from './synthetic.js';

const INBOX = '0x' + 'ab'.repeat(32);
const SUI = '0x2::sui::SUI';
const DUMMY = '0x97fb7c::dummy_coin::DUMMY_COIN';
const escrowId = id<'Escrow'>(ESCROW_ID);

const sumMist = (byCoin: ReadonlyArray<{ amountMist: bigint }>) =>
  byCoin.reduce((a, c) => a + c.amountMist, 0n);

describe('memoryInbox partition + collect', () => {
  it('fetch partitions messages by coin type (§5.2)', () => {
    const inbox = memoryInbox();
    inbox.post(INBOX, { coinType: SUI, amountMist: mist(100n) });
    inbox.post(INBOX, { coinType: SUI, amountMist: mist(50n) });
    inbox.post(INBOX, { coinType: DUMMY, amountMist: mist(200n) });

    const groups = inbox.fetch(INBOX);
    expect(groups.size).toBe(2); // two coin types
    const suiKey = [...groups.keys()].find((k) => k.includes('sui'))!;
    expect(groups.get(suiKey)!.length).toBe(2);
  });

  it('collect drains the inbox and totals per coin', () => {
    const inbox = memoryInbox();
    inbox.post(INBOX, { coinType: SUI, amountMist: mist(100n) });
    inbox.post(INBOX, { coinType: SUI, amountMist: mist(50n) });
    inbox.post(INBOX, { coinType: DUMMY, amountMist: mist(200n) });

    const { byCoin } = inbox.collect(INBOX, ms(0n));
    expect(byCoin).toHaveLength(2);
    const sui = byCoin.find((c) => c.coinType.includes('sui'))!;
    expect(sui.count).toBe(2);
    expect(sui.amountMist).toBe(150n);
    const dummy = byCoin.find((c) => c.coinType.includes('dummy'))!;
    expect(dummy.amountMist).toBe(200n);

    expect(inbox.has(INBOX)).toBe(false); // drained
    expect(inbox.size).toBe(0);
  });

  it('seeds from { inboxId, groups }', () => {
    const a = memoryInbox();
    a.post(INBOX, { coinType: SUI, amountMist: mist(900n) });
    const b = memoryInbox([{ inboxId: INBOX, groups: a.fetch(INBOX) }]);
    expect(sumMist(b.collect(INBOX, ms(0n)).byCoin)).toBe(900n);
  });
});

describe('memoryInbox — escrow ↔ inbox 90/10 conservation (offline)', () => {
  it('a handover settlement posts 90/10; collected == used credit', () => {
    const EARN = '0x' + 'e1'.repeat(32);
    const FEE = '0x' + 'f2'.repeat(32);

    // Demand with a handover that expires early; apply past it → settlement.
    const mem = memorySource([demandState(0n, 1_000n)]);
    const t = ms(50_000n);
    const result = mem.apply(escrowId, actions.applyPendingTransitionStates(), t);
    expect(result.settlement).toBeTruthy();
    const s = result.settlement!;
    expect(s.governorShareMist + s.feeMist).toBe(s.usedMist); // the split

    // Bridge the split into the two inboxes (synthetic states are SUI-coined).
    const inbox = memoryInbox();
    postSettlement(inbox, { earningsId: EARN, feeId: FEE }, SUI, s);

    const earned = sumMist(inbox.collect(EARN, t).byCoin);
    const feed = sumMist(inbox.collect(FEE, t).byCoin);
    expect(earned).toBe(s.governorShareMist); // 90% → governor
    expect(feed).toBe(s.feeMist); // 10% → protocol fee
    expect(earned + feed).toBe(s.usedMist); // nothing created or lost
  });

  it('a tenure expiry posts the full-stake 90/10; collected == used', () => {
    const EARN = '0x' + 'e3'.repeat(32);
    const FEE = '0x' + 'f4'.repeat(32);

    // Occupied, applied past its tenure boundary → full-stake settlement.
    const mem = memorySource([occupiedState(0n, 60_000n)]); // boundary at 60_000
    const t = ms(60_000n);
    const result = mem.apply(escrowId, actions.applyPendingTransitionStates(), t);
    expect(result.tenureSettlement).toBeTruthy();
    const s = result.tenureSettlement!;
    expect(s.governorShareMist + s.feeMist).toBe(s.usedMist); // the split

    const inbox = memoryInbox();
    postSettlement(inbox, { earningsId: EARN, feeId: FEE }, SUI, s);
    const earned = sumMist(inbox.collect(EARN, t).byCoin);
    const feed = sumMist(inbox.collect(FEE, t).byCoin);
    expect(earned).toBe(s.governorShareMist);
    expect(feed).toBe(s.feeMist);
    expect(earned + feed).toBe(s.usedMist); // conservation, tenure-expiry path
  });
});

describe('memoryInbox — global fee pool (one inbox, many escrows)', () => {
  it('per-governor earnings, but one protocol fee inbox accumulates Σ fee', () => {
    const FEE = '0x' + 'fe'.repeat(32); // the single global ProtocolFeeInbox
    const t = ms(60_000n);
    const escrows = [
      { id: id<'Escrow'>('0x' + 'a1'.repeat(32)), earnings: '0x' + 'e1'.repeat(32), stake: 1_000n },
      { id: id<'Escrow'>('0x' + 'a2'.repeat(32)), earnings: '0x' + 'e2'.repeat(32), stake: 2_000n },
      { id: id<'Escrow'>('0x' + 'a3'.repeat(32)), earnings: '0x' + 'e3'.repeat(32), stake: 3_000n },
    ];
    const mem = memorySource(
      escrows.map((e) => ({ ...occupiedState(0n, 60_000n, { stakeMist: e.stake }), objectId: e.id })),
    );
    const inbox = memoryInbox();

    let totalFee = 0n;
    for (const e of escrows) {
      const s = mem.apply(e.id, actions.applyPendingTransitionStates(), t).tenureSettlement!;
      // 90% → this escrow's OWN earnings inbox; 10% → the shared fee inbox.
      postSettlement(inbox, { earningsId: e.earnings, feeId: FEE }, SUI, s);
      totalFee += s.feeMist;
      // each governor drains only its own earnings = its governorShare.
      expect(sumMist(inbox.collect(e.earnings, t).byCoin)).toBe(s.governorShareMist);
    }

    // the single fee inbox holds the protocol-wide total: splitFee of 1000/2000/
    // 3000 → fee 100/200/300 = 600.
    expect(sumMist(inbox.collect(FEE, t).byCoin)).toBe(totalFee);
    expect(totalFee).toBe(600n);
  });
});
