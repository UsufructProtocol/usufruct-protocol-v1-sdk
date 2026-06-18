/**
 * Borrow recipes, end to end on testnet — the *composable* face of ③ BORROW.
 *
 * The borrow middle has one job: be the single zone where your code lives. A
 * recipe is just a `Use` — a named constant, or a factory `(args) => Use` when
 * it needs parameters — written in its own file (`recipes/dummy-asset.ts`) and
 * imported here. `cap.borrow` is variadic: pass one, or several, and they
 * compose in order. The borrow before and the return after are appended for
 * you, around the whole composed middle.
 *
 * Two wallets: Alice (the market maker) and Bob (a renter). Run: `npm run demo:recipes`.
 */
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { coinTag, usufruct } from '@usufruct-protocol/sdk';
import { createdId, loadSigner, makeClient, rateLimited, send } from './lib.js';
import { DUMMY_PKG, inspectAsset, useAndKeepCoupon } from './recipes/dummy-asset.js';

// dummy axes (free mint) — the payment coin alongside Alice's asset
const DUMMY_COIN_PKG = '0x97fb7c77162e3edf6a44815ec9eb29b69f9a43747dfb1c1019a7fc5501e2ad96';
const DUMMY_COIN_TREASURY =
  '0xccee2bc2227913f441c7544892cf5d220880cbc0c55be8733b4b6777def976bc';
const DUMMY = coinTag({ type: `${DUMMY_COIN_PKG}::dummy_coin::DUMMY_COIN`, decimals: 9, symbol: 'DUMMY' });

const client = rateLimited(makeClient());

const ALICE = loadSigner(); // the market maker
const BOB = Ed25519Keypair.generate(); // a renter

async function setup(): Promise<string> {
  const tx = new Transaction();
  const sword = tx.moveCall({ target: `${DUMMY_PKG}::dummy_asset::mint` });
  tx.transferObjects([sword], ALICE.toSuiAddress());
  tx.transferObjects([tx.splitCoins(tx.gas, [200_000_000n])[0]!], BOB.toSuiAddress());
  tx.transferObjects(
    [tx.moveCall({ target: `${DUMMY_COIN_PKG}::dummy_coin::mint`, arguments: [tx.object(DUMMY_COIN_TREASURY), tx.pure.u64(1_000_000_000n)] })],
    BOB.toSuiAddress(),
  );
  return createdId(await send(client, tx, ALICE), '::dummy_asset::DummyAsset');
}

async function main() {
  const swordId = await setup();

  // ① + ② — list, then rent (same as the canonical demo)
  const alice = usufruct({ network: 'testnet', client, signer: ALICE });
  const { escrow } = await alice.integrate({
    asset: swordId,
    coin: DUMMY,
    market: {
      restPrice: DUMMY(0.01),
      tenure: '20s',
      multiTenure: false,
      creditShape: 'linear',
      auctionShape: 'smoothstep',
      descent: '10s',
      handover: '5s',
      escalation: { fixed: DUMMY(0.001) },
      retireCommitment: 'immediate',
      ensembleCommitment: 'immediate',
    },
  }).send();
  console.log(`① listed ${escrow.id}`);

  const bob = usufruct({ network: 'testnet', client, signer: BOB });
  const sword = await bob.escrow(escrow.id);
  const cap = await sword.rent({ tenures: 1 }).send();
  console.log(`② rented — usufructCap ${cap.id}\n`);

  // ════════════ ③ BORROW — recipes imported from another file, composed in place ════════════
  // The middle is no longer an inline lambda. `inspectAsset` (a bare `Use`) and
  // `useAndKeepCoupon(addr)` (a factory) live in recipes/dummy-asset.ts; borrow
  // is variadic, so it composes them in order — no explicit `sequence`. The
  // borrow before and the return after are still appended for you.
  const { digest } = await cap
    .borrow(
      inspectAsset, //                          read the use count  (&Asset)
      useAndKeepCoupon(BOB.toSuiAddress()), //  use, keep the coupon (&mut Asset)
    )
    .send();
  console.log('③ borrowed → inspect → use → return, one PTB, recipes imported & composed');
  console.log(`   ${digest}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
