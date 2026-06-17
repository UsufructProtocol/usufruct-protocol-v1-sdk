/**
 * Object-centric reads — ask the object about itself, the read twin of the
 * writes. The seat economics live on the `UsufructCap` (`cap.state()`), not on the
 * escrow; the escrow keeps escrow-whole reads + the bid preview / governance reads.
 *
 *   ① INTEGRATE + RENT → the active cap: cap.state().role==='active', stake>0
 *   ② CHALLENGE        → the challenger's pending cap routes to pending; active-only
 *                        fields (accrued / time-remaining) gate to null
 *   ③ ESCROW           → escrow-whole reads stay (floorPrice, nextFloorPrice preview)
 *   ④ GOVERNANCE       → governanceCap.governs(escrow) === true
 *
 * Writes need a funded signer; reclaim with `npm run clean`. Run: `npm run reads`.
 */
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { coinTag, usufruct, type Market } from '@usufruct-protocol/sdk';
import { check, createdId, finish, loadSigner, makeClient, rateLimited, send, step } from './lib.js';

const DUMMY_PKG = '0xa72e830fcb3e688ab3c20ff3cbd0a149cd1b58715709905585e75eb18317a52a';
const DUMMY_COIN_PKG = '0x97fb7c77162e3edf6a44815ec9eb29b69f9a43747dfb1c1019a7fc5501e2ad96';
const DUMMY_COIN_TREASURY = '0xccee2bc2227913f441c7544892cf5d220880cbc0c55be8733b4b6777def976bc';
const DUMMY = coinTag({ type: `${DUMMY_COIN_PKG}::dummy_coin::DUMMY_COIN`, decimals: 9, symbol: 'DUMMY' });

const client = rateLimited(makeClient());
const ALICE = loadSigner();
const me = ALICE.toSuiAddress();

async function newRenter(): Promise<Ed25519Keypair> {
  const kp = Ed25519Keypair.generate();
  const tx = new Transaction();
  tx.transferObjects([tx.splitCoins(tx.gas, [60_000_000n])[0]!], kp.toSuiAddress());
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

const market: Market = {
  restPrice: DUMMY(0.01),
  tenure: '5m',
  multiTenure: false,
  creditShape: 'linear',
  auctionShape: 'linear',
  descent: 'off',
  handover: '15s',
  escalation: { fixed: DUMMY(0.001) },
  retireCommitment: 'immediate',
  ensembleCommitment: 'immediate',
};

async function main(): Promise<void> {
  const a = usufruct({ network: 'testnet', client, signer: ALICE });

  step('① integrate + rent — ask the ACTIVE cap about itself (cap.state())');
  const { escrow, governanceCap } = await a.integrate({ asset: await mintAsset(), coin: DUMMY, market });
  const bob = await newRenter();
  const ub = usufruct({ network: 'testnet', client, signer: bob });
  await (await ub.escrow(escrow.id)).rent({ tenures: 1 });

  const occ = await a.escrow(escrow.id);
  const activeCap = await a.usufructCap(occ.activeUsufructCapId!); // read-only resolve, no ownership
  const active = await activeCap.state();
  check('active cap: role === active', active.role === 'active', active.role);
  check('active cap: stake > 0', (active.stake?.mist ?? 0n) > 0n, active.stake?.format());
  check('active cap: timeRemainingMs > 0', (active.timeRemainingMs ?? 0) > 0, `${active.timeRemainingMs} ms`);
  check('active cap: accruedCredit surfaced', active.accruedCredit !== null, active.accruedCredit?.format());
  check('active cap: usufructuary is Bob', active.usufructuaryAddr === bob.toSuiAddress());
  check('activeCap.isActive() === true', (await activeCap.isActive()) === true);

  step('② challenge — the PENDING cap routes to pending, active-only fields gate to null');
  const carol = await newRenter();
  const uc = usufruct({ network: 'testnet', client, signer: carol });
  await (await uc.escrow(escrow.id)).rent({ tenures: 1 }); // bid on the occupied escrow → demand
  const demand = await a.escrow(escrow.id);
  const pendingCap = await a.usufructCap(demand.pendingUsufructCapId!);
  const pending = await pendingCap.state();
  check('pending cap: role === pending', pending.role === 'pending', pending.role);
  check('pending cap: stake > 0', (pending.stake?.mist ?? 0n) > 0n, pending.stake?.format());
  check('pending cap: committedTenures set', pending.committedTenures !== null, `${pending.committedTenures}`);
  check('pending cap: accruedCredit gated to null', pending.accruedCredit === null);
  check('pending cap: timeRemainingMs gated to null', pending.timeRemainingMs === null, `${pending.timeRemainingMs}`);
  check('pendingCap.isActive() === false', (await pendingCap.isActive()) === false);

  step('③ escrow keeps escrow-whole reads (floor + bid preview)');
  const preview = await demand.nextFloorPrice(demand.coin(1), 1);
  check('nextFloorPrice ≥ floorPrice', preview.mist >= demand.floorPrice.mist, `${preview.format()} ≥ ${demand.floorPrice.format()}`);

  step('④ governance — the cap answers whether it governs this escrow');
  check('governanceCap.governs(escrow) === true', (await governanceCap.governs(escrow.id)) === true);
}

main().then(finish);
