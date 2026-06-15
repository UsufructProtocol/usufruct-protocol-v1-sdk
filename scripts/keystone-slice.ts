/**
 * Live testnet validation of the Layer 2 keystone slice (Phase E).
 *
 * The chain is the arbiter: this drives the NEW high-level API end-to-end —
 *   usufruct({ signer: bob }) → escrow(id) → rent({ payment }) → cap.borrow(use)
 * against a freshly integrated escrow, and asserts each step on-chain.
 *
 * Bob is an ephemeral keypair, funded (SUI gas + a DUMMY coin) from the signer
 * we already use (`loadSigner()`). Dummy asset/coin are free-mint. Spends only
 * a little gas. Run: `npm run keystone`.
 */
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import * as actions from '../src/actions/index.js';
import { TESTNET } from '../src/config/network.js';
import { id, mist } from '../src/primitives/brand.js';
import { coinTag, price, usufruct } from '../src/index.js';
import {
  check,
  createdId,
  finish,
  loadSigner,
  makeClient,
  rateLimited,
  send,
  step,
} from './lib.js';

// Dummy axes (free mint; zero economic noise) — same as the main e2e harness.
const DUMMY_PKG = '0xa72e830fcb3e688ab3c20ff3cbd0a149cd1b58715709905585e75eb18317a52a';
const DUMMY_COIN_PKG = '0x97fb7c77162e3edf6a44815ec9eb29b69f9a43747dfb1c1019a7fc5501e2ad96';
const DUMMY_COIN_TREASURY =
  '0xccee2bc2227913f441c7544892cf5d220880cbc0c55be8733b4b6777def976bc';
const ASSET_T = `${DUMMY_PKG}::dummy_asset::DummyAsset`;
const COIN_T = `${DUMMY_COIN_PKG}::dummy_coin::DUMMY_COIN`;
const TYPE_ARGS: [string, string] = [ASSET_T, COIN_T];

// The escrow's coin, as a Layer 2 tag — used here to express an overpay amount.
const DUMMY = coinTag({ type: COIN_T, decimals: 9, symbol: 'DUMMY_COIN' });

const REST_PRICE = 10_000_000n; // floor (mist) = 0.01 DUMMY_COIN — the known rest price
const TENURE_MS = 120_000n;
const ensemble = {
  restPrice: REST_PRICE,
  tenureMs: TENURE_MS,
  multiTenure: true, // renting >1 tenure at once (default Single aborts EMultiCycleNotAllowed)
  handover: { kind: 'fixed', floorMs: 25_000n },
} as Parameters<typeof actions.integrate>[0]['ensemble'];

const client = rateLimited(makeClient());
const funder = loadSigner();
const me = funder.toSuiAddress();

const mintAsset = (tx: Transaction) => tx.moveCall({ target: `${DUMMY_PKG}::dummy_asset::mint` });
const mintCoin = (tx: Transaction, amount: bigint) =>
  tx.moveCall({
    target: `${DUMMY_COIN_PKG}::dummy_coin::mint`,
    arguments: [tx.object(DUMMY_COIN_TREASURY), tx.pure.u64(amount)],
  });

/** Integrate a fresh idle escrow (funder = governor); return its id. */
async function integrate(): Promise<ReturnType<typeof id<'Escrow'>>> {
  const tx = new Transaction();
  const r = actions
    .integrate({ ensemble, assetType: ASSET_T, coinType: COIN_T })
    .toPtb(tx, { pkg: TESTNET, asset: mintAsset(tx), typeArguments: TYPE_ARGS });
  tx.transferObjects([r[0]!, r[1]!], me);
  const res = await send(client, tx, funder);
  return id<'Escrow'>(createdId(res, '::escrow::Escrow'));
}

async function main() {
  console.log(`funder: ${me}`);

  step('0. generate Bob + fund him (SUI gas + DUMMY coin) from the funder');
  const bob = Ed25519Keypair.generate();
  const bobAddr = bob.toSuiAddress();
  {
    const tx = new Transaction();
    const [gas] = tx.splitCoins(tx.gas, [200_000_000n]); // 0.2 SUI for gas
    tx.transferObjects([gas!], bobAddr);
    tx.transferObjects([mintCoin(tx, 1_000_000_000n)], bobAddr); // 1 DUMMY to pay rent
    await send(client, tx, funder);
    check('Bob generated + funded', true, bobAddr);
  }

  step('1. setup — integrate a fresh idle escrow');
  const escrowA = await integrate();
  check('escrow A integrated', escrowA.length === 66, escrowA);

  step('2. NEW API — Bob reads it (state + role in one fetch)');
  const u = usufruct({ client, signer: bob });
  const sword = await u.escrow(escrowA);
  check('status idle', sword.status === 'idle', sword.status);
  check('isAvailable', sword.isAvailable === true);
  check('canRent (Bob has a signer)', sword.canRent === true);
  check('canBorrow false (no cap yet)', sword.canBorrow === false);
  check('floorPrice == rest price', sword.floorPrice.mist === REST_PRICE, `${sword.floorPrice}`);

  step('3. NEW API — Bob rents 2 tenures (pay defaults to floor×2)');
  const cap = await sword.rent({ tenures: 2 });
  check('cap minted + received', cap.id.length === 66, cap.id);
  check('receipt.paid == floor×2', cap.receipt?.paid.mist === REST_PRICE * 2n, `${cap.receipt?.paid}`);
  check(
    'receipt.expiresAt in the future',
    (cap.receipt?.expiresAt.getTime() ?? 0) > Date.now(),
    cap.receipt?.expiresAt.toISOString(),
  );

  step('4. NEW API — keystone: cap.borrow → use_asset → guaranteed return (one PTB)');
  const { digest, returned } = await cap.borrow((asset, tx) => {
    const coupon = tx.moveCall({
      target: `${DUMMY_PKG}::dummy_asset::use_asset`,
      arguments: [asset],
    });
    tx.transferObjects([coupon], bobAddr);
  });
  check('borrow returned the asset (one PTB)', returned === true, digest);

  step('5. NEW API — role re-resolves: Bob now holds the active cap');
  const swordAfter = await u.escrow(escrowA);
  check('canBorrow true now', swordAfter.canBorrow === true);
  check('escrow.usufructCap id matches the rented cap', swordAfter.usufructCap?.id === cap.id, `${swordAfter.usufructCap?.id}`);
  check('status occupied', swordAfter.status === 'occupied', swordAfter.status);

  step('6. overpay is allowed — the minimum is not a maximum (fresh escrow)');
  const escrowB = await integrate();
  const swordB = await u.escrow(escrowB);
  const overpayMist = REST_PRICE * 2n + 500n;
  const capB = await swordB.rent({ tenures: 2, pay: price(mist(overpayMist), DUMMY) });
  check('overpay receipt.paid == requested', capB.receipt?.paid.mist === overpayMist, `${capB.receipt?.paid}`);
  const swordB2 = await u.escrow(escrowB);
  const stake = await swordB2.reader.activeStakeBalanceMist();
  check('overpay became stake on-chain', stake === overpayMist, `stake=${stake}`);

  finish();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
