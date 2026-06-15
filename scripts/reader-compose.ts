/**
 * Do the drift-free kernel `Reader` and the Layer-2 high-level API compose?
 *
 * The thesis: a `Reader` read taken BEFORE a high-level write and AFTER it must
 * differ — the Reader sees what the write did, with no extra wiring. The Reader
 * hangs straight off the handle (`escrow.reader`); you never re-thread packageId
 * / escrowId / typeArguments. And it's LIVE (every call hits the chain), whereas
 * the handle's getters are a snapshot at fetch time — so the same `reader` object
 * can be queried again after each write to observe the new state.
 *
 * We interleave reads with three different write verbs and assert each flipped:
 *
 *   A · CONFIG  — reader.restPrice()          before/after governanceCap.updateMarket({restPrice})
 *   B · STATE   — reader.isOccupied()/cap      before/after a rent (Escrow handle)
 *   C · LAZY    — reader.activeUsufructCapId() before/after applyPendingTransitionStates()
 *
 * Run: `npm run compose`.
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
const ALICE = loadSigner();
const me = ALICE.toSuiAddress();

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

  const market: Market = {
    restPrice: DUMMY(0.01),
    tenure: '20s', // short, so C can settle a lapsed tenure during the demo
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
  const { escrow, governanceCap } = await a.integrate({ asset: await mintAsset(), coin: DUMMY, market });
  const reader = escrow.reader; // ← the drift-free kernel reader, straight off the handle
  console.log(`listed ${escrow.id}; reader hangs off the handle (no re-wiring)\n`);

  // ════════════ A · CONFIG — restPrice before/after governanceCap.updateMarket ════════════
  const restBefore = (await reader.restPrice()).priceMist;
  await governanceCap.updateMarket(escrow, { restPrice: DUMMY(0.025) }); // high-level write
  const restAfter = (await reader.restPrice()).priceMist;
  console.log(`A · restPrice  ${restBefore} → ${restAfter} mist`);
  check('reader.restPrice reflects governanceCap.updateMarket', restBefore !== restAfter && restAfter === DUMMY(0.025).mist);

  // ════════════ B · STATE — isOccupied / activeUsufructCapId before/after rent ════════════
  const [occBefore, capBefore] = [await reader.isOccupied(), await reader.activeUsufructCapId()];
  const ub = usufruct({ network: 'testnet', client, signer: bob });
  const bobCap = await (await ub.escrow(escrow.id)).rent({ tenures: 1, payment: ub.fromBalance(DUMMY) }); // high-level write
  const [occAfter, capAfter] = [await reader.isOccupied(), await reader.activeUsufructCapId()];
  console.log(`B · isOccupied ${occBefore} → ${occAfter}; activeCap ${capBefore} → ${capAfter}`);
  check('reader.isOccupied flips false→true on rent', occBefore === false && occAfter === true);
  check('reader.activeUsufructCapId becomes the minted cap', capBefore === null && capAfter === bobCap.id);

  // ════════════ C · LAZY — activeUsufructCapId before/after applyPendingTransitionStates ════════════
  console.log('\nC · waiting out the tenure, then applying the lazy transition…');
  await waitForChainTime(client, BigInt(bobCap.receipt!.expiresAt.getTime()));
  const capPreApply = await reader.activeUsufructCapId();
  await (await a.escrow(escrow.id)).applyPendingTransitionStates(); // high-level write
  const [occPostApply, capPostApply] = [await reader.isOccupied(), await reader.activeUsufructCapId()];
  console.log(`C · activeCap ${capPreApply} → ${capPostApply}; isOccupied now ${occPostApply}`);
  check('reader.activeUsufructCapId clears on settlement', capPreApply === bobCap.id && capPostApply === null);
  check('reader.isOccupied is false after the tenure settles', occPostApply === false);

  finish();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
