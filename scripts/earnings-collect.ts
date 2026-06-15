/**
 * The governor's earnings, end to end on testnet — the symmetric twin of the
 * protocol fee (see protocol-fee.ts). The SAME settlement that posts 10% of
 * consumed credit to the deployer's ProtocolFeeInbox posts the other 90% to the
 * governor's `EarningsInbox`. That inbox is also a bearer object (`key + store`),
 * one per escrow, held by the governor. Anyone may *preview* its balance (a
 * read), but `collect()` mutates `&mut EarningsInbox` — so the chain rejects a
 * collect signed by anyone who doesn't hold it. Authority IS possession.
 *
 *   ① INTEGRATE  — Alice (governor) lists; she holds the EarningsInbox
 *   ② RENT       — Bob takes it; his stake is the credit that will be consumed
 *   ③ EXPIRE     — the tenure lapses; apply settles → 90% earnings posted
 *   ④ PREVIEW    — the earnings delta is exactly 90% of consumed credit
 *   ⑤ GUARD      — Bob (a non-holder) cannot collect Alice's earnings — chain refuses
 *   ⑥ COLLECT    — Alice collects (she holds the inbox), partitioned by coin
 *
 * Run: `npm run earnings`.
 */
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { coinTag, usufruct, type Market } from '../src/index.js';
import { check, createdId, finish, loadSigner, makeClient, rateLimited, send, waitForChainTime } from './lib.js';

const DUMMY_PKG = '0xa72e830fcb3e688ab3c20ff3cbd0a149cd1b58715709905585e75eb18317a52a';
const DUMMY_COIN_PKG = '0x97fb7c77162e3edf6a44815ec9eb29b69f9a43747dfb1c1019a7fc5501e2ad96';
const DUMMY_COIN_TREASURY =
  '0xccee2bc2227913f441c7544892cf5d220880cbc0c55be8733b4b6777def976bc';
const COIN_T = `${DUMMY_COIN_PKG}::dummy_coin::DUMMY_COIN`;
const DUMMY = coinTag({ type: COIN_T, decimals: 9, symbol: 'DUMMY' });

const client = rateLimited(makeClient());
const ALICE = loadSigner(); // governor — holds the EarningsInbox
const me = ALICE.toSuiAddress();

/** Fund a fresh renter with SUI for gas + a DUMMY coin to pay with. */
async function newRenter(): Promise<Ed25519Keypair> {
  const kp = Ed25519Keypair.generate();
  const tx = new Transaction();
  tx.transferObjects([tx.splitCoins(tx.gas, [200_000_000n])[0]!], kp.toSuiAddress());
  tx.transferObjects(
    [tx.moveCall({ target: `${DUMMY_COIN_PKG}::dummy_coin::mint`, arguments: [tx.object(DUMMY_COIN_TREASURY), tx.pure.u64(1_000_000_000n)] })],
    kp.toSuiAddress(),
  );
  await send(client, tx, ALICE);
  return kp;
}

async function mintAsset(): Promise<string> {
  const tx = new Transaction();
  tx.transferObjects([tx.moveCall({ target: `${DUMMY_PKG}::dummy_asset::mint` })], me);
  return createdId(await send(client, tx, ALICE), '::dummy_asset::DummyAsset');
}

async function main() {
  const bob = await newRenter();

  // ════════════ ① INTEGRATE — Alice lists; holds the EarningsInbox ════════════
  const market: Market = {
    restPrice: DUMMY(0.01),
    tenure: '20s', // short, so it lapses during the demo and the earnings settle
    multiTenure: false,
    creditShape: 'linear',
    auctionShape: 'linear',
    descent: 'off',
    handover: 'off',
    escalation: { fixed: DUMMY(0.001) },
    retireCommitment: 'immediate',
    ensembleCommitment: 'immediate',
  };
  const a = usufruct({ network: 'testnet', client, signer: ALICE });
  const { escrow, earningsInbox } = await a.integrate({ asset: await mintAsset(), coin: DUMMY, market });
  console.log(`① Alice listed ${escrow.id}`);
  console.log(`   earnings inbox (one per escrow) = ${earningsInbox.inboxId}\n`);

  // Fresh inbox → before is 0, but we still measure a DELTA, symmetric with the fee.
  const dummyMist = async () =>
    (await earningsInbox.balance()).find((b) => b.coin === COIN_T)?.amount.mist ?? 0n;
  const before = await dummyMist();

  // ════════════ ② RENT — Bob takes it; pays the stake that becomes credit ════════════
  const ub = usufruct({ network: 'testnet', client, signer: bob });
  const bobCap = await (await ub.escrow(escrow.id)).rent({ tenures: 1 });
  console.log(`② Bob rented — paid ${bobCap.receipt!.paid}; tenure ends ${bobCap.receipt!.expiresAt.toISOString()}\n`);

  // ════════════ ③ EXPIRE — wait out the tenure, then settle (posts the earnings) ════════════
  console.log('③ waiting out the tenure, then settling (apply posts earnings + fee)…');
  await waitForChainTime(client, BigInt(bobCap.receipt!.expiresAt.getTime()));
  await (await a.escrow(escrow.id)).applyPendingTransitionStates();
  console.log(`   settled — status is now ${(await a.escrow(escrow.id)).status}\n`);

  // ════════════ ④ PREVIEW — the earnings delta is exactly 90% of consumed credit ════════════
  const after = await dummyMist();
  const delta = after - before;
  const expected = DUMMY(0.009).mist; // 90% (credit − 10% fee) of the 0.01 consumed
  console.log(`④ EarningsInbox DUMMY: ${before} → ${after} mist (Δ ${delta})`);
  check('this run posted exactly 90% of consumed credit', delta === expected, `Δ=${delta}, expected=${expected}`);

  // ════════════ ⑤ GUARD — a non-holder cannot collect; the chain refuses ════════════
  // Authority IS possession: Bob doesn't hold the inbox, so his collect (which
  // needs &mut EarningsInbox) is rejected at execution — not by our code, by Sui.
  const bobEarnings = ub.earningsInbox(earningsInbox.inboxId);
  let refused = false;
  try {
    await bobEarnings.collect();
  } catch {
    refused = true;
  }
  check('Bob (non-holder) cannot collect Alice’s earnings', refused);

  // ════════════ ⑥ COLLECT — Alice collects (she holds the inbox), by coin (§5.2) ════════════
  const collected = await earningsInbox.collect();
  console.log(`⑥ Alice swept:`, collected.map((b) => `${b.amount}`).join(', ') || '(empty)');
  const collectedDummy = collected.find((b) => b.coin === COIN_T)?.amount.mist ?? 0n;
  check('Alice collected at least this run’s earnings', collectedDummy >= expected, `${collectedDummy} mist`);
  check('inbox DUMMY is empty after collect', (await dummyMist()) === 0n);

  finish();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
