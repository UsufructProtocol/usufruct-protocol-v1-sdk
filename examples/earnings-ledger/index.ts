/**
 * PROBE — the settlement ledger: both sides of every settlement, summed from events.
 *
 * Each settlement splits 90/10 — the governor's `EarningsInbox` and the protocol's
 * `ProtocolFeeInbox`. Both are coin-polymorphic mailboxes, and the SAME two methods
 * read both (the handle is generic over `EarningsMessagePosted` / `FeeMessagePosted`):
 *
 *   inbox.history()  → every message ever posted (settled AND collected)
 *   inbox.totals()   → that, summed PER COIN
 *
 * It lists two escrows — one priced in DUMMY (9-dec, free-mint), one in USDC (6-dec,
 * a real testnet coin) — into ONE earnings inbox, settles each, and reads back BOTH
 * inboxes: the governor's 90% and the protocol's 10%, per coin. Proves the methods are
 * coin-polymorphic AND symmetric across both inbox kinds.
 *
 * Run from the monorepo root:  npx tsx examples/earnings-ledger/index.ts
 * Needs a small USDC balance for the second arm (see README).
 */
import { Transaction } from '@mysten/sui/transactions';
import { coinTag, usufruct } from '@usufruct-protocol/sdk';
import type { Inbox, InboxMessage } from '@usufruct-protocol/sdk';
import { GRAPHQL_TESTNET } from '@usufruct-protocol/sdk/config/network.js';
import { check, createdId, finish, loadSigner, makeClient, rateLimited, send, step, waitForChainTime } from '../../scripts/lib.js';

const DUMMY_PKG = '0xa72e830fcb3e688ab3c20ff3cbd0a149cd1b58715709905585e75eb18317a52a';
const DUMMY_COIN_PKG = '0x97fb7c77162e3edf6a44815ec9eb29b69f9a43747dfb1c1019a7fc5501e2ad96';
const DUMMY_COIN_TREASURY = '0xccee2bc2227913f441c7544892cf5d220880cbc0c55be8733b4b6777def976bc';
const DUMMY = coinTag({ type: `${DUMMY_COIN_PKG}::dummy_coin::DUMMY_COIN`, decimals: 9, symbol: 'DUMMY' });
const USDC_TYPE = '0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC';

const client = rateLimited(makeClient());
const me = loadSigner();

async function mintAsset(): Promise<string> {
  const tx = new Transaction();
  tx.transferObjects([tx.moveCall({ target: `${DUMMY_PKG}::dummy_asset::mint` })], me.toSuiAddress());
  tx.transferObjects(
    [tx.moveCall({ target: `${DUMMY_COIN_PKG}::dummy_coin::mint`, arguments: [tx.object(DUMMY_COIN_TREASURY), tx.pure.u64(1_000_000_000n)] })],
    me.toSuiAddress(),
  );
  return createdId(await send(client, tx, me), '::dummy_asset::DummyAsset');
}

const norm = (id: string | null) => (id ?? '').replace(/^0x/, '').toLowerCase();

/** Poll an inbox (filtered to `mine`) out of GraphQL indexing lag until `want` land. */
async function waitForMessages(inbox: Inbox, mine: Set<string>, want: number): Promise<InboxMessage[]> {
  for (let i = 0; i < 18; i++) {
    const log = (await inbox.inspect.history()).filter((m) => mine.has(norm(m.escrowId)));
    if (log.length >= want) return log;
    await new Promise((r) => setTimeout(r, 5000));
  }
  return (await inbox.inspect.history()).filter((m) => mine.has(norm(m.escrowId)));
}

/** Sum messages per coin → printable `symbol → mist`. */
function sumByCoin(msgs: InboxMessage[]): Map<string, bigint> {
  const m = new Map<string, bigint>();
  for (const x of msgs) m.set(x.coin, (m.get(x.coin) ?? 0n) + x.amount.mist);
  return m;
}

async function main() {
  const u = usufruct({ client, signer: me, graphql: GRAPHQL_TESTNET });
  const USDC = await u.coinType(USDC_TYPE); // decimals (6) + symbol from chain
  check('USDC resolved its 6 decimals from chain (not the default 9)', USDC.decimals === 6, `${USDC.decimals}`);

  const market = (over: 'DUMMY' | 'USDC') => {
    const c = over === 'DUMMY' ? DUMMY : USDC;
    return {
      restPrice: c(0.01), tenure: '15s', multiTenure: false,
      creditShape: 'linear' as const, auctionShape: 'linear' as const, descent: 'off' as const, handover: 'off' as const,
      escalation: { fixed: c(0.001) }, retireCommitment: 'immediate' as const, ensembleCommitment: 'immediate' as const,
    };
  };

  step('list escrow A priced in DUMMY — creates the earnings inbox');
  const { escrow: escrowA, governanceCap, earningsInbox } = await u.write
    .integrate({ asset: await mintAsset(), coin: DUMMY, market: market('DUMMY') })
    .send();
  const feeInbox = await (await u.nav.escrow(escrowA.id)).nav.feeInbox(); // the protocol's singleton fee pool

  step('list escrow B priced in USDC INTO THE SAME inbox (governanceCap.integrateIntoPortfolio)');
  const escrowB = await governanceCap.write
    .integrateIntoPortfolio(await mintAsset(), USDC, market('USDC'), { earningsInbox: earningsInbox.inboxId })
    .send();
  const mine = new Set([norm(escrowA.id), norm(escrowB.id)]);

  // Settle both: each tenure runs to expiry and pays the governor 90% of the stake.
  for (const [label, id, pay] of [
    ['DUMMY', escrowA.id, DUMMY(0.5)],
    ['USDC', escrowB.id, USDC(0.5)],
  ] as const) {
    step(`settle the ${label} escrow — rent ${pay.format()}, run to expiry (governor earns ~90%)`);
    const seat = await u.nav.escrow(id);
    const cap = await seat.write.rent({ tenures: 1, pay }).send();
    await waitForChainTime(client, BigInt(cap.receipt!.expiresAt.getTime()));
    await seat.write.applyPendingTransitionStates().send();
  }

  step('the two inboxes, read by the SAME methods — governor 90% (earnings) + protocol 10% (fees)');
  const earnMsgs = await waitForMessages(earningsInbox, mine, 2);
  const feeMsgs = await waitForMessages(feeInbox, mine, 2);
  const earn = sumByCoin(earnMsgs);
  const fee = sumByCoin(feeMsgs);

  const dummy = `${DUMMY_COIN_PKG}::dummy_coin::DUMMY_COIN`.replace(/^0x/, '');
  const usdc = USDC_TYPE.replace(/^0x/, '');
  // Both events carry coin_type in type_name format (no 0x prefix); match on that.
  const get = (m: Map<string, bigint>, t: string) => [...m].find(([k]) => k.replace(/^0x/, '') === t)?.[1] ?? 0n;

  console.log('   coin     stake   governor (90%)   protocol (10%)');
  for (const [sym, t, stake, dec] of [['DUMMY', dummy, 0.5, 1e9], ['USDC', usdc, 0.5, 1e6]] as const) {
    console.log(`   ${sym.padEnd(6)}  ${stake.toFixed(2)}    ${(Number(get(earn, t)) / dec).toFixed(4).padStart(8)}        ${(Number(get(fee, t)) / dec).toFixed(4).padStart(8)}`);
  }

  const earnTotals = await earningsInbox.inspect.totals();
  console.log(`\n   earningsInbox.totals(): ${earnTotals.map((x) => x.total.format()).join(', ')}`);
  console.log(`   feeInbox.totals() (deployment-wide): ${(await feeInbox.inspect.totals()).map((x) => x.total.format()).join(', ')}`);

  check('earnings inbox is coin-polymorphic (DUMMY + USDC)', earnTotals.length === 2, `${earnTotals.length} coins`);
  check('governor earned 90% per coin', get(earn, dummy) === 450_000_000n && get(earn, usdc) === 450_000n, `${get(earn, dummy)} / ${get(earn, usdc)}`);
  check('protocol took 10% per coin (same methods, FeeInbox)', get(fee, dummy) === 50_000_000n && get(fee, usdc) === 50_000n, `${get(fee, dummy)} / ${get(fee, usdc)}`);
  check('90% + 10% = the stake, per coin (each in its own decimals)', get(earn, dummy) + get(fee, dummy) === 500_000_000n && get(earn, usdc) + get(fee, usdc) === 500_000n);

  finish();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
