/**
 * The always-liquid challenge / displacement, end to end on testnet — the
 * protocol's defining write path. Renting an OCCUPIED escrow IS the bid; the
 * sitting tenant gets a handover window before being displaced. Narrative.
 *
 *   ① INTEGRATE  — Alice lists, with a handover (displacement-protection) window
 *   ② RENT       — Bob takes it (Occupied)
 *   ③ CHALLENGE  — Carol rents the occupied escrow = the bid (→ Demand)
 *   ④ READ       — the always-liquid state: who's active, who's pending, handover
 *   ⑤ HANDOVER   — wait + apply → Carol takes over, Bob is displaced
 *   ⑥ STALE      — Bob's cap is now stale; he burns it
 *
 * Run: `npm run challenge`.
 */
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { coinTag, usufruct, type Market } from '../src/index.js';
import { createdId, loadSigner, makeClient, rateLimited, send, sleep, waitForChainTime } from './lib.js';

const DUMMY_PKG = '0xa72e830fcb3e688ab3c20ff3cbd0a149cd1b58715709905585e75eb18317a52a';
const DUMMY_COIN_PKG = '0x97fb7c77162e3edf6a44815ec9eb29b69f9a43747dfb1c1019a7fc5501e2ad96';
const DUMMY_COIN_TREASURY =
  '0xccee2bc2227913f441c7544892cf5d220880cbc0c55be8733b4b6777def976bc';
const COIN_T = `${DUMMY_COIN_PKG}::dummy_coin::DUMMY_COIN`;
const DUMMY = coinTag({ type: COIN_T, decimals: 9, symbol: 'DUMMY' });

const client = rateLimited(makeClient());
const ALICE = loadSigner();
const me = ALICE.toSuiAddress();

/** Mint an asset to Alice, fund a fresh renter with SUI gas + a DUMMY coin. */
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
  const [bob, carol] = [await newRenter(), await newRenter()];

  // ════════════ ① INTEGRATE — Alice lists with a handover window ════════════
  const market: Market = {
    restPrice: DUMMY(0.01),
    tenure: '5m', // long, so the tenure doesn't expire during the demo
    coin: DUMMY,
    multiTenure: false,
    creditShape: 'linear',
    auctionShape: 'linear',
    descent: 'off',
    handover: '15s', // a displaced tenant keeps the asset 15s (displacement protection)
    escalation: { fixed: DUMMY(0.001) },
    retireCommitment: 'immediate',
    ensembleCommitment: 'immediate',
  };
  const a = usufruct({ network: 'testnet', client, signer: ALICE });
  const { escrow } = await a.integrate({ asset: await mintAsset(), market });
  console.log(`① listed ${escrow.id}\n`);

  // ════════════ ② RENT — Bob takes it ════════════
  const ub = usufruct({ network: 'testnet', client, signer: bob });
  const bobCap = await (await ub.escrow(escrow.id)).rent({ tenures: 1, payment: ub.fromBalance(DUMMY) });
  console.log(`② Bob rented — cap ${bobCap.id}, paid ${bobCap.receipt!.paid}\n`);

  // ════════════ ③ CHALLENGE — Carol rents the OCCUPIED escrow (the bid) ════════════
  const uc = usufruct({ network: 'testnet', client, signer: carol });
  const occupied = await uc.escrow(escrow.id);
  console.log(`③ Carol sees status=${occupied.status}, ascending floor=${occupied.floorPrice} → she bids`);
  const carolCap = await occupied.rent({ tenures: 1, payment: uc.fromBalance(DUMMY) }); // renting occupied = the bid
  console.log(`   Carol bid — cap ${carolCap.id}, paid ${carolCap.receipt!.paid}\n`);

  // ════════════ ④ READ — the always-liquid state, off the Escrow handle ════════════
  const demand = await uc.escrow(escrow.id);
  console.log(`④ status=${demand.status} (challenged=${demand.isChallenged})`);
  console.log(`   active cap (sitting tenant) = ${demand.activeUsufructCapId === bobCap.id ? 'Bob' : demand.activeUsufructCapId}`);
  console.log(`   pending (challenger)        = ${demand.pendingUsufructuaryAddr === carol.toSuiAddress() ? 'Carol' : demand.pendingUsufructuaryAddr}`);
  console.log(`   handover expires at         = ${demand.handoverExpiresAt?.toISOString()}\n`);

  // ════════════ ⑤ HANDOVER — wait out Bob's window, settle ════════════
  console.log('⑤ waiting out the handover window, then settling…');
  await waitForChainTime(client, BigInt(demand.handoverExpiresAt!.getTime()));
  await demand.applyPendingTransitionStates();
  const after = await uc.escrow(escrow.id);
  console.log(`   status=${after.status}; active cap is now ${after.activeUsufructCapId === carolCap.id ? 'Carol' : after.activeUsufructCapId}\n`);

  // ════════════ ⑥ STALE — Bob's cap is now dead weight; he burns it ════════════
  // bobCap already carries Bob's signer; burnIfStale() checks the chain then burns.
  const { burned, digest } = await bobCap.burnIfStale();
  console.log(`⑥ Bob's cap was stale → burnIfStale() burned=${burned} (${digest})`);

  await sleep(0);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
