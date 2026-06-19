/**
 * PROBE — the earnings ledger: a governor's lifetime income, summed from events,
 * across EVERY coin the inbox receives.
 *
 * The `EarningsInbox` has `balance()` (uncollected objects right now) and `watch()`
 * (live push). Neither answers "how much has this inbox earned, ever?" — collected
 * income has left the inbox, and `watch()` only sees the future. The event log does:
 * every settlement emits `EarningsMessagePosted { earnings_inbox_id, amount, coin_type }`.
 *
 *   earningsInbox.history()  → every message ever posted (settled AND collected)
 *   earningsInbox.totals()   → that, summed PER COIN (the inbox is coin-polymorphic)
 *
 * The inbox is coin-polymorphic: one governor can list assets priced in different
 * coins, all paying the SAME inbox. This drives a settlement in DUMMY and one in USDC
 * (6-decimal, a real testnet coin), into one inbox, and proves `totals()` returns a
 * separate, correctly-scaled entry per coin.
 *
 * Run from the monorepo root:  npx tsx examples/earnings-ledger/index.ts
 * Needs a small USDC balance for the second arm (see README).
 */
import { Transaction } from '@mysten/sui/transactions';
import { coinTag, usufruct } from '@usufruct-protocol/sdk';
import type { EarningsInbox } from '@usufruct-protocol/sdk';
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

/** Wait out GraphQL indexing lag until `inbox` shows at least `want` messages. */
async function waitForMessages(inbox: EarningsInbox, want: number) {
  for (let i = 0; i < 18; i++) {
    const log = await inbox.history();
    if (log.length >= want) return log;
    await new Promise((r) => setTimeout(r, 5000));
  }
  return inbox.history();
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
  const { escrow: escrowA, governanceCap, earningsInbox } = await u
    .integrate({ asset: await mintAsset(), coin: DUMMY, market: market('DUMMY') })
    .send();

  step('list escrow B priced in USDC INTO THE SAME inbox (governanceCap.integrateIntoPortfolio)');
  const escrowB = await governanceCap
    .integrateIntoPortfolio(await mintAsset(), USDC, market('USDC'), { earningsInbox: earningsInbox.inboxId })
    .send();

  // Settle both: each tenure runs to expiry and pays the governor 90% of the stake.
  for (const [label, id, pay] of [
    ['DUMMY', escrowA.id, DUMMY(0.5)],
    ['USDC', escrowB.id, USDC(0.5)],
  ] as const) {
    step(`settle the ${label} escrow — rent ${pay.format()}, run to expiry (governor earns ~90%)`);
    const seat = await u.escrow(id);
    const cap = await seat.rent({ tenures: 1, pay }).send();
    await waitForChainTime(client, BigInt(cap.receipt!.expiresAt.getTime()));
    await seat.applyPendingTransitionStates().send();
  }

  step('earningsInbox.history() — every posted message, across coins (waiting out indexer lag)');
  const log = await waitForMessages(earningsInbox, 2);
  for (const m of log) {
    console.log(`   ${(m.at ?? new Date(0)).toISOString().slice(11, 19)}  ${m.amount.format().padStart(13)}  from ${m.escrowId?.slice(0, 10)}…`);
  }

  step('earningsInbox.totals() — lifetime income summed PER COIN');
  const totals = await earningsInbox.totals();
  for (const t of totals) {
    console.log(`   ${t.total.format().padStart(13)}  across ${t.count} settlement(s)  (${t.coin.split('::').pop()})`);
  }

  // The event's coin_type is type_name format (no 0x prefix) — match by module/struct.
  const dummyT = totals.find((t) => t.coin.includes('dummy_coin'));
  const usdcT = totals.find((t) => t.coin.includes('usdc'));
  check('totals() has TWO coin entries (coin-polymorphic)', totals.length === 2, `${totals.length} coins`);
  check('DUMMY total is 0.45 (9-decimal: 90% of 0.5)', dummyT?.total.mist === 450_000_000n, `${dummyT?.total.format()}`);
  check('USDC total is 0.45 (6-decimal: 90% of 0.5, NOT 9-decimal coupled)', usdcT?.total.mist === 450_000n, `${usdcT?.total.format()}`);
  const sum = log.reduce((acc, m) => acc.set(m.coin, (acc.get(m.coin) ?? 0n) + m.amount.mist), new Map<string, bigint>());
  check('each coin total = sum of that coin’s messages', totals.every((t) => t.total.mist === sum.get(t.coin)));

  finish();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
