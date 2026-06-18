/**
 * The protocol fee, end to end on testnet — the fourth bearer object, and a
 * clean proof that authority IS possession. Of every credit a usufructuary
 * consumes, 90% flows to the governor's EarningsInbox and 10% to the deployer's
 * `ProtocolFeeInbox`. That inbox is a deployment singleton (`key + store`),
 * owned by whoever published the package. Anyone may *preview* its balance (a
 * read), but `collect()` mutates `&mut ProtocolFeeInbox` — so the chain itself
 * rejects a collect signed by anyone who doesn't hold the object.
 *
 *   ① INTEGRATE  — Alice (governor) lists with a short tenure
 *   ② RENT       — Bob takes it; his stake is the credit that will be consumed
 *   ③ EXPIRE     — the tenure lapses; apply settles → 10% fee posted to the inbox
 *   ④ PREVIEW    — the fee delta is exactly 10% of consumed credit (anyone can read)
 *   ⑤ GUARD      — Alice (a non-holder) cannot collect — the chain refuses
 *   ⑥ COLLECT    — the deployer collects (it holds the inbox), partitioned by coin
 *
 * Two real signers: ALICE (the SDK test address, acts as governor) and PROTOCOL
 * (whoever owns the ProtocolFeeInbox — derived on-chain from the deployment, no
 * hardcoded alias; see `loadFeeOwner`).
 *
 * Run: `npm run fee`.
 */
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { coinTag, usufruct, type Market } from '@usufruct-protocol/sdk';
import { TESTNET } from '@usufruct-protocol/sdk/config/network.js';
import { check, createdId, finish, loadFeeOwner, loadSigner, makeClient, rateLimited, send, waitForChainTime } from './lib.js';

const DUMMY_PKG = '0xa72e830fcb3e688ab3c20ff3cbd0a149cd1b58715709905585e75eb18317a52a';
const DUMMY_COIN_PKG = '0x97fb7c77162e3edf6a44815ec9eb29b69f9a43747dfb1c1019a7fc5501e2ad96';
const DUMMY_COIN_TREASURY =
  '0xccee2bc2227913f441c7544892cf5d220880cbc0c55be8733b4b6777def976bc';
const COIN_T = `${DUMMY_COIN_PKG}::dummy_coin::DUMMY_COIN`;
const DUMMY = coinTag({ type: COIN_T, decimals: 9, symbol: 'DUMMY' });

const client = rateLimited(makeClient());
const ALICE = loadSigner(); // governor (the SDK test address)
const PROTOCOL = await loadFeeOwner(client, TESTNET.feeRefId); // owns the ProtocolFeeInbox (derived on-chain)
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

  // ════════════ ① INTEGRATE — Alice lists with a short tenure ════════════
  const market: Market = {
    restPrice: DUMMY(0.01),
    tenure: '20s', // short, so it lapses during the demo and the fee settles
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
  const { escrow } = await a.integrate({ asset: await mintAsset(), coin: DUMMY, market }).send();
  console.log(`① Alice listed ${escrow.id}`);
  console.log(`   protocol fee inbox (singleton) = ${escrow.feeInboxId}\n`);

  // The fee inbox is a deployment SINGLETON shared by every escrow — its balance
  // is the running total of UNCOLLECTED fees across all escrows and coins. So we
  // measure this run's contribution as a DELTA, not as the absolute balance.
  // The holder resolves it with no id: u.feeInbox() reads the configured feeRef.
  const p = usufruct({ network: 'testnet', client, signer: PROTOCOL });
  const feeInbox = await p.feeInbox(); // arg-less: resolved from the configured ProtocolFeeRef
  check('u.feeInbox() resolves the same singleton as escrow.feeInboxId', feeInbox.inboxId === escrow.feeInboxId);
  const dummyMist = async () =>
    (await feeInbox.balance()).find((b) => b.coin === COIN_T)?.amount.mist ?? 0n;
  const before = await dummyMist();

  // ════════════ ② RENT — Bob takes it; pays the stake that becomes credit ════════════
  const ub = usufruct({ network: 'testnet', client, signer: bob });
  const bobCap = await (await ub.escrow(escrow.id)).rent({ tenures: 1 }).send();
  console.log(`② Bob rented — paid ${bobCap.receipt!.paid}; tenure ends ${bobCap.receipt!.expiresAt.toISOString()}\n`);

  // ════════════ ③ EXPIRE — wait out the tenure, then settle (posts the fee) ════════════
  console.log('③ waiting out the tenure, then settling (apply posts earnings + fee)…');
  await waitForChainTime(client, BigInt(bobCap.receipt!.expiresAt.getTime()));
  await (await a.escrow(escrow.id)).applyPendingTransitionStates().send();
  console.log(`   settled — status is now ${(await a.escrow(escrow.id)).status}\n`);

  // ════════════ ④ PREVIEW — the fee delta is exactly 10% of consumed credit ════════════
  const after = await dummyMist();
  const delta = after - before;
  const expected = DUMMY(0.001).mist; // 10% (PROTOCOL_FEE_BPS=1000) of the 0.01 consumed
  console.log(`④ ProtocolFeeInbox DUMMY: ${before} → ${after} mist (Δ ${delta})`);
  check('this run posted exactly 10% of consumed credit', delta === expected, `Δ=${delta}, expected=${expected}`);

  // ════════════ ⑤ GUARD — a non-holder cannot collect; the chain refuses ════════════
  // Authority IS possession: Alice doesn't hold the inbox, so her collect (which
  // needs &mut ProtocolFeeInbox) is rejected at execution — not by our code, by Sui.
  const aliceFeeInbox = await a.feeInbox();
  let refused = false;
  try {
    await aliceFeeInbox.collect().send();
  } catch {
    refused = true;
  }
  check('Alice (non-holder) cannot collect the protocol fee', refused);

  // ════════════ ⑥ COLLECT — the deployer collects, partitioned by coin (§5.2) ════════════
  const collected = await feeInbox.collect().send();
  console.log(`⑥ deployer swept:`, collected.map((b) => `${b.amount}`).join(', ') || '(empty)');
  const collectedDummy = collected.find((b) => b.coin === COIN_T)?.amount.mist ?? 0n;
  check('deployer collected at least this run’s fee', collectedDummy >= expected, `${collectedDummy} mist`);
  check('inbox DUMMY is empty after collect', (await dummyMist()) === 0n);

  finish();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
