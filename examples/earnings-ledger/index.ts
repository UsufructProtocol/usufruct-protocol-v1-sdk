/**
 * PROBE — the earnings ledger: a governor's lifetime income, summed from events.
 *
 * The `EarningsInbox` has `balance()` (uncollected objects right now) and `watch()`
 * (live push). Neither answers "how much has this inbox earned, ever?" — collected
 * income has left the inbox, and `watch()` only sees the future. The event log does:
 * every settlement emits `EarningsMessagePosted { earnings_inbox_id, amount, coin_type }`.
 *
 * This adds the event-sourced twin:
 *   earningsInbox.history()  → every message ever posted (settled AND collected)
 *   earningsInbox.totals()   → that, summed per coin (the inbox is coin-polymorphic)
 *
 * It drives two settlements (rent → tenure expiry pays the governor 90% of the
 * principal) and reads the ledger back.
 *
 * Run from the monorepo root:  npx tsx examples/earnings-ledger/index.ts
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

const client = rateLimited(makeClient());
const me = loadSigner();

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
  step('setup — list (15s tenure, descent off → tenure expiry settles straight to the governor)');
  const tx = new Transaction();
  tx.transferObjects([tx.moveCall({ target: `${DUMMY_PKG}::dummy_asset::mint` })], me.toSuiAddress());
  tx.transferObjects(
    [tx.moveCall({ target: `${DUMMY_COIN_PKG}::dummy_coin::mint`, arguments: [tx.object(DUMMY_COIN_TREASURY), tx.pure.u64(2_000_000_000n)] })],
    me.toSuiAddress(),
  );
  const assetId = createdId(await send(client, tx, me), '::dummy_asset::DummyAsset');

  const u = usufruct({ client, signer: me, graphql: GRAPHQL_TESTNET });
  const { escrow, earningsInbox } = await u
    .integrate({
      asset: assetId, coin: DUMMY,
      market: {
        restPrice: DUMMY(0.01), tenure: '15s', multiTenure: false,
        creditShape: 'linear', auctionShape: 'linear', descent: 'off', handover: 'off',
        escalation: { fixed: DUMMY(0.001) }, retireCommitment: 'immediate', ensembleCommitment: 'immediate',
      },
    })
    .send();
  const seat = await u.escrow(escrow.id);

  // Two tenures run to completion → two settlements pay the governor 90% of each stake.
  for (const stake of [0.5, 0.6]) {
    step(`settlement — rent ${stake} DUMMY, run the tenure to expiry (governor earns ~90%)`);
    const cap = await seat.rent({ tenures: 1, pay: DUMMY(stake) }).send();
    await waitForChainTime(client, BigInt(cap.receipt!.expiresAt.getTime()));
    await seat.applyPendingTransitionStates().send();
  }

  step('earningsInbox.history() — every posted message (waiting out indexer lag)');
  const log = await waitForMessages(earningsInbox, 2);
  for (const m of log) {
    console.log(`   ${(m.at ?? new Date(0)).toISOString().slice(11, 19)}  ${m.amount.format().padStart(12)}  from ${m.escrowId?.slice(0, 10)}…`);
  }

  step('earningsInbox.totals() — lifetime income summed per coin');
  const totals = await earningsInbox.totals();
  for (const t of totals) {
    console.log(`   ${t.total.format()}  across ${t.count} settlements  (${t.coin.split('::').pop()})`);
  }

  const sum = log.reduce((a, m) => a + m.amount.mist, 0n);
  check('two settlements posted', log.length === 2, `${log.length} messages`);
  check('totals() = sum of every posted message', totals.length === 1 && totals[0]!.total.mist === sum, `${totals[0]?.total.format()} = Σ messages`);
  check('each settlement paid the governor 90% of the stake', log.every((m, i) => m.amount.mist === BigInt(Math.round([0.5, 0.6][i]! * 0.9 * 1e9))), log.map((m) => m.amount.format()).join(', '));

  finish();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
