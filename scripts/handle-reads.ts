/**
 * Handle reads (P1 #6) — the common reads surfaced off `escrow.reader` onto the
 * handle, validated live: stake balances, time-remaining, commitment unlocks,
 * next floor price. Proves the gating (null when not rented) and the rich types.
 *
 *   ① INTEGRATE  → idle: activeStake / timeRemainingMs are null (gated)
 *   ② RENT       → occupied: activeStake > 0, timeRemainingMs > 0
 *   ③ PREVIEW    → nextFloorPrice(bid, 1) ≥ floorPrice
 *   ④ COMMITMENTS→ retireUnlocksAt() / ensembleUnlocksAt() are Dates (≈ now, immediate)
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

  step('① integrate — idle escrow: rented-only reads are gated to null');
  const { escrow } = await a.integrate({ asset: await mintAsset(), coin: DUMMY, market });
  const idle = await a.escrow(escrow.id);
  check('idle: activeStake is null', idle.activeStake === null);
  check('idle: pendingStake is null', idle.pendingStake === null);
  check('idle: timeRemainingMs is null', idle.timeRemainingMs === null, `${idle.timeRemainingMs}`);

  step('② rent — occupied escrow: stake + time-remaining surface as rich types');
  const bob = await newRenter();
  const ub = usufruct({ network: 'testnet', client, signer: bob });
  await (await ub.escrow(escrow.id)).rent({ tenures: 1 });
  const occ = await a.escrow(escrow.id);
  check('occupied status', occ.status === 'occupied', occ.status);
  check('activeStake > 0', (occ.activeStake?.mist ?? 0n) > 0n, occ.activeStake?.format());
  check('timeRemainingMs > 0', (occ.timeRemainingMs ?? 0) > 0, `${occ.timeRemainingMs} ms`);

  step('③ nextFloorPrice — a bid preview, ≥ the current floor');
  const preview = await occ.nextFloorPrice(occ.coin(1), 1);
  check('nextFloorPrice ≥ floorPrice', preview.mist >= occ.floorPrice.mist, `${preview.format()} ≥ ${occ.floorPrice.format()}`);

  step('④ commitment unlocks — Dates (≈ now for an immediate commitment)');
  const [retireAt, ensembleAt] = await Promise.all([occ.retireUnlocksAt(), occ.ensembleUnlocksAt()]);
  check('retireUnlocksAt is a Date', retireAt instanceof Date && !Number.isNaN(retireAt.getTime()), retireAt.toISOString());
  check('ensembleUnlocksAt is a Date', ensembleAt instanceof Date && !Number.isNaN(ensembleAt.getTime()), ensembleAt.toISOString());
}

main().then(finish);
