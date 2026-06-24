/**
 * dogfood-run.ts — full rental lifecycle against Sui testnet, driven ONLY by
 * the public SDK API as documented in llms-full.txt.
 *
 *   mint → integrate (DUMMY-priced escrow) → read floor → rent → borrow → read
 *
 * Run: npx tsx scripts/dogfood-run.ts
 */
import { loadSigner, makeClient, rateLimited, send, createdId } from './lib.js';
import { Transaction } from '@mysten/sui/transactions';
import { coinTag, usufruct } from '@usufruct-protocol/sdk';

const DUMMY_ASSET_PKG = '0xa72e830fcb3e688ab3c20ff3cbd0a149cd1b58715709905585e75eb18317a52a';
// DummyAsset funcs: mint(): DummyAsset  ·  use_asset(&mut DummyAsset, &mut TxContext): Coupon
const DUMMY = coinTag({ type: '0x97fb7c77162e3edf6a44815ec9eb29b69f9a43747dfb1c1019a7fc5501e2ad96::dummy_coin::DUMMY_COIN', decimals: 9, symbol: 'DUMMY' });

const client = rateLimited(makeClient());
const signer = loadSigner();
const me = signer.toSuiAddress();

async function mintAsset(): Promise<string> {
  const tx = new Transaction();
  tx.transferObjects([tx.moveCall({ target: `${DUMMY_ASSET_PKG}::dummy_asset::mint` })], me);
  return createdId(await send(client, tx, signer), '::dummy_asset::DummyAsset');
}

async function main(): Promise<void> {
  const u = usufruct({ network: 'testnet', client, signer });
  console.log('signer:', me);

  // 1. Mint a DummyAsset.
  const assetId = await mintAsset();
  console.log('\n[1] minted DummyAsset:', assetId);

  // 2. Integrate it into a fresh escrow priced in DUMMY.
  const { escrow, governanceCap, earningsInbox } = await u.write.integrate({
    asset: assetId,
    coin: DUMMY,
    market: {
      restPrice: DUMMY(0.01),       // floor when idle
      tenure: '2m',
      multiTenure: false,
      creditShape: 'linear',
      auctionShape: 'linear',
      descent: 'off',
      handover: 'off',
      escalation: { fixed: DUMMY(0.001) },
      retireCommitment: 'immediate',
      ensembleCommitment: 'immediate',
    },
  }).send();
  console.log('\n[2] integrated:');
  console.log('    escrow      :', escrow.id);
  console.log('    governance  :', governanceCap.capId);
  console.log('    earnings    :', earningsInbox.inboxId);
  const stateAfterIntegrate = await escrow.read.assetState();
  console.log('    asset-state :', stateAfterIntegrate.kind);

  // 3. Print the floor price (formatted).
  const floor = await escrow.read.floorPrice();
  console.log('\n[3] floor price:', floor.format());

  // 4. Rent it for 1 tenure (pay the floor).
  const cap = await escrow.write.rent({ tenures: 1 }).send();
  const status = (await cap.read.state()).status;
  console.log('\n[4] rented:');
  console.log('    cap id      :', cap.id);
  console.log('    cap status  :', status);
  console.log('    paid        :', cap.receipt?.paid.format());

  // 5. Borrow the rented asset to call use_asset(&mut DummyAsset): Coupon, keep the Coupon.
  const { digest } = await cap.write.borrow((asset, tx) => {
    const coupon = tx.moveCall({ target: `${DUMMY_ASSET_PKG}::dummy_asset::use_asset`, arguments: [asset] });
    tx.transferObjects([coupon], me);
  }).send();
  console.log('\n[5] borrowed + used asset; coupon kept');
  console.log('    borrow digest:', digest);

  // 6. Final asset-state kind.
  const finalState = await escrow.read.assetState();
  console.log('\n[6] final asset-state:', finalState.kind);

  console.log('\nDONE.');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
