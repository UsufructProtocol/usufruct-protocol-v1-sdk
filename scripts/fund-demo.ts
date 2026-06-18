/**
 * Fund a fresh demo wallet for examples/wallet-demo: SUI (gas) + a DummyAsset (to
 * `integrate`) + DUMMY coins (to pay `rent` floors). One PTB, signed by the
 * project signer.  Run: tsx scripts/fund-demo.ts <address>
 */
import { Transaction } from '@mysten/sui/transactions';
import { createdId, loadSigner, makeClient, rateLimited, send } from './lib.js';

const DUMMY_PKG = '0xa72e830fcb3e688ab3c20ff3cbd0a149cd1b58715709905585e75eb18317a52a';
const DUMMY_COIN_PKG = '0x97fb7c77162e3edf6a44815ec9eb29b69f9a43747dfb1c1019a7fc5501e2ad96';
const DUMMY_COIN_TREASURY = '0xccee2bc2227913f441c7544892cf5d220880cbc0c55be8733b4b6777def976bc';

const target = process.argv[2];
if (!target?.startsWith('0x')) throw new Error('usage: tsx scripts/fund-demo.ts <0xaddress>');

const client = rateLimited(makeClient());
const kp = loadSigner();

const tx = new Transaction();
const asset = tx.moveCall({ target: `${DUMMY_PKG}::dummy_asset::mint` });
const coin = tx.moveCall({
  target: `${DUMMY_COIN_PKG}::dummy_coin::mint`,
  arguments: [tx.object(DUMMY_COIN_TREASURY), tx.pure.u64(2_000_000_000n)],
});
const sui = tx.splitCoins(tx.gas, [300_000_000n]);
tx.transferObjects([asset, coin, sui[0]!], target);

const res = await send(client, tx, kp);
console.log('funded', target);
console.log('  DummyAsset', createdId(res, '::dummy_asset::DummyAsset'));
console.log('  +2.0 DUMMY, +0.3 SUI');
console.log('  digest', res.digest);
