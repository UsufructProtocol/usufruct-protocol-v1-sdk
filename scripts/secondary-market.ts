/**
 * The secondary market, end to end on testnet — the object-centric model made
 * visible. The four capability objects are `key + store` bearer objects; moving
 * the object moves the role. Here three of them change hands independently and
 * the role follows possession every time — we assert it from each new holder.
 *
 *   ① INTEGRATE   — Alice lists; she holds the GovernanceCap + the EarningsInbox
 *   ② RENT        — Bob takes the right of use (a UsufructCap)
 *   ③ ASSIGN INC  — Alice assigns the EarningsInbox → Eve (governance stays hers)
 *   ④ SELL GOV    — Alice sells the GovernanceCap → Dave (Alice fully exits)
 *   ⑤ RESELL LEASE— Bob resells his UsufructCap → Carol
 *
 * The point: earnings ≠ governance ≠ use. Each is a free-standing object with
 * its own holder; the handle's `canGovern` / `earningsInbox` / `usufructCap`
 * flip purely on who holds the object — no role registry, no permission table.
 *
 * Run: `npm run secondary`.
 */
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { coinTag, usufruct, type Market } from '../src/index.js';
import { check, createdId, finish, loadSigner, makeClient, rateLimited, send } from './lib.js';

const DUMMY_PKG = '0xa72e830fcb3e688ab3c20ff3cbd0a149cd1b58715709905585e75eb18317a52a';
const DUMMY_COIN_PKG = '0x97fb7c77162e3edf6a44815ec9eb29b69f9a43747dfb1c1019a7fc5501e2ad96';
const DUMMY_COIN_TREASURY =
  '0xccee2bc2227913f441c7544892cf5d220880cbc0c55be8733b4b6777def976bc';
const COIN_T = `${DUMMY_COIN_PKG}::dummy_coin::DUMMY_COIN`;
const DUMMY = coinTag({ type: COIN_T, decimals: 9, symbol: 'DUMMY' });

const client = rateLimited(makeClient());
const ALICE = loadSigner();
const me = ALICE.toSuiAddress();

/** Fund a fresh actor with SUI for gas (they don't pay rent). */
async function newActor(): Promise<Ed25519Keypair> {
  const kp = Ed25519Keypair.generate();
  const tx = new Transaction();
  tx.transferObjects([tx.splitCoins(tx.gas, [200_000_000n])[0]!], kp.toSuiAddress());
  await send(client, tx, ALICE);
  return kp;
}

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

/** Re-resolve the escrow from `who`'s perspective (possession = role). */
const seenBy = (who: Ed25519Keypair, escrowId: string) =>
  usufruct({ network: 'testnet', client, signer: who }).escrow(escrowId);

async function main() {
  // Funded one at a time — concurrent funding would equivocate Alice's gas coin.
  const [bob, carol, dave, eve] = [await newRenter(), await newActor(), await newActor(), await newActor()];

  // ════════════ ① INTEGRATE — Alice lists; holds GovernanceCap + EarningsInbox ════════════
  const market: Market = {
    restPrice: DUMMY(0.01),
    tenure: '1h',
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
  const { escrow, governanceCap, earningsInbox } = await a.integrate({ asset: await mintAsset(), coin: DUMMY, market });
  console.log(`① Alice listed ${escrow.id}`);
  check('Alice governs after integrate', (await seenBy(ALICE, escrow.id)).canGovern);
  check('Alice holds the EarningsInbox after integrate', (await seenBy(ALICE, escrow.id)).earningsInbox != null);

  // ════════════ ② RENT — Bob takes the right of use ════════════
  const bobCap = await (await seenBy(bob, escrow.id)).rent({ tenures: 1 });
  console.log(`\n② Bob rented — UsufructCap ${bobCap.id}`);
  check('Bob can borrow after renting', (await seenBy(bob, escrow.id)).canBorrow);

  // ════════════ ③ ASSIGN INCOME — EarningsInbox → Eve (governance stays Alice's) ════════════
  await earningsInbox.transfer(eve.toSuiAddress());
  console.log(`\n③ Alice assigned the income stream → Eve`);
  check('Eve now holds the EarningsInbox', (await seenBy(eve, escrow.id)).earningsInbox != null);
  check('Alice no longer holds the EarningsInbox', (await seenBy(ALICE, escrow.id)).earningsInbox == null);
  check('Alice still governs (earnings ≠ governance)', (await seenBy(ALICE, escrow.id)).canGovern);

  // ════════════ ④ SELL GOVERNORSHIP — GovernanceCap → Dave (Alice fully exits) ════════════
  await governanceCap.transfer(dave.toSuiAddress());
  console.log(`\n④ Alice sold the governorship → Dave`);
  const aliceAfter = await seenBy(ALICE, escrow.id);
  check('Dave now governs', (await seenBy(dave, escrow.id)).canGovern);
  check('Dave holds a GovernanceCap handle', (await seenBy(dave, escrow.id)).governanceCap != null);
  check('Alice no longer governs', !aliceAfter.canGovern);
  check('Alice holds nothing here (fully exited)', !aliceAfter.canGovern && aliceAfter.earningsInbox == null);

  // ════════════ ⑤ RESELL THE LEASE — Bob's UsufructCap → Carol ════════════
  await bobCap.transfer(carol.toSuiAddress());
  console.log(`\n⑤ Bob resold the right of use → Carol`);
  check('Carol can borrow (holds the active cap)', (await seenBy(carol, escrow.id)).canBorrow);
  check('Carol holds a UsufructCap handle', (await seenBy(carol, escrow.id)).usufructCap != null);
  check('Bob can no longer borrow', !(await seenBy(bob, escrow.id)).canBorrow);

  finish();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
