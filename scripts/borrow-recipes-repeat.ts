/**
 * The same recipe, composed several times — variadic `borrow` applies its
 * steps left-to-right, so repeating one repeats its commands inside the one bracket.
 *
 *   cap.borrow(inspectAsset, useAndKeepCoupon(BOB) ×3)
 *
 * Result: one borrow → one read → three uses (three coupons minted & sent) →
 * one return, all in a single atomic PTB. Run: `npm run demo:recipes:repeat`.
 */
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { coinTag, usufruct } from '@usufruct-protocol/sdk';
import { createdId, loadSigner, makeClient, rateLimited, send } from './lib.js';
import { DUMMY_PKG, inspectAsset, useAndKeepCoupon } from './recipes/dummy-asset.js';

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

  const alice = usufruct({ network: 'testnet', client, signer: ALICE });
  const { escrow } = await alice.write.integrate({
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
  const sword = await bob.nav.escrow(escrow.id);
  const cap = await sword.write.rent({ tenures: 1 }).send();
  console.log(`② rented — usufructCap ${cap.id}\n`);

  // ③ BORROW — the SAME recipe, composed multiple times in one bracket.
  // borrow is variadic: repeating a step repeats its commands, in order.
  const { digest } = await cap.write
    .borrow(
      inspectAsset, //                          read the use count  (&Asset)
      useAndKeepCoupon(BOB.toSuiAddress()), //  use, keep the coupon (&mut Asset)
      useAndKeepCoupon(BOB.toSuiAddress()), //  use, keep the coupon (&mut Asset)
      useAndKeepCoupon(BOB.toSuiAddress()), //  use, keep the coupon (&mut Asset)
    )
    .send();
  console.log('③ borrowed → inspect → use ×3 → return, one PTB');
  console.log(`   ${digest}`);
  console.log(`   suiscan.xyz/testnet/tx/${digest}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
