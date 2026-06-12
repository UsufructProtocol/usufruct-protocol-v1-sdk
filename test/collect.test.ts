import { Transaction } from '@mysten/sui/transactions';
import { describe, expect, it } from 'vitest';
import { collectMessages, type MessageRef } from '../src/actions/collect.js';
import { TESTNET } from '../src/config/network.js';

const INBOX = '0x' + '88'.repeat(32);
const DCOIN = '0x97fb7c77162e3edf6a44815ec9eb29b69f9a43747dfb1c1019a7fc5501e2ad96::dummy_coin::DUMMY_COIN';
const SUI = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';

const ref = (n: number): MessageRef => ({
  objectId: '0x' + String(n).padStart(2, '0').repeat(32),
  version: '5',
  digest: '11111111111111111111111111111111',
});

describe('coin-polymorphic collect (§5.2)', () => {
  it('emits one MakeMoveVec + one collect call per coin type, never mixing', () => {
    const groups = new Map([
      [DCOIN, [ref(1), ref(2)]],
      [SUI, [ref(3)]],
    ]);
    const tx = new Transaction();
    const coins = collectMessages({ kind: 'earnings', groups }).toPtb(tx, {
      pkg: TESTNET,
      inboxId: INBOX,
    });
    expect(coins).toHaveLength(2);

    const commands = tx.getData().commands;
    const vecs = commands.filter((c) => c.$kind === 'MakeMoveVec');
    const calls = commands.filter((c) => c.$kind === 'MoveCall');
    expect(vecs).toHaveLength(2);
    expect(calls).toHaveLength(2);

    // Each vector is typed with the fully-qualified Receiving<…<C>> — the
    // §5.2 discipline that prevents the receive_impl abort.
    expect(vecs[0]!.MakeMoveVec!.type).toBe(
      `0x2::transfer::Receiving<${TESTNET.packageId}::earnings_message::EarningsMessage<${DCOIN}>>`,
    );
    expect(vecs[0]!.MakeMoveVec!.elements).toHaveLength(2);
    expect(vecs[1]!.MakeMoveVec!.type).toBe(
      `0x2::transfer::Receiving<${TESTNET.packageId}::earnings_message::EarningsMessage<${SUI}>>`,
    );
    expect(vecs[1]!.MakeMoveVec!.elements).toHaveLength(1);

    expect(calls.map((c) => c.MoveCall!.function)).toEqual([
      'collect_earnings_messages',
      'collect_earnings_messages',
    ]);
    expect(calls.map((c) => c.MoveCall!.typeArguments[0])).toEqual([DCOIN, SUI]);
  });

  it('fees kind targets fees::collect_fee_messages with FeeMessage tickets', () => {
    const tx = new Transaction();
    collectMessages({ kind: 'fees', groups: new Map([[SUI, [ref(4)]]]) }).toPtb(tx, {
      pkg: TESTNET,
      inboxId: INBOX,
    });
    const commands = tx.getData().commands;
    expect(commands.find((c) => c.$kind === 'MakeMoveVec')!.MakeMoveVec!.type).toContain(
      '::fee_message::FeeMessage<',
    );
    expect(commands.find((c) => c.$kind === 'MoveCall')!.MoveCall!.function).toBe(
      'collect_fee_messages',
    );
  });

  it('skips empty groups', () => {
    const tx = new Transaction();
    const coins = collectMessages({
      kind: 'earnings',
      groups: new Map([[SUI, []]]),
    }).toPtb(tx, { pkg: TESTNET, inboxId: INBOX });
    expect(coins).toHaveLength(0);
    expect(tx.getData().commands).toHaveLength(0);
  });
});
