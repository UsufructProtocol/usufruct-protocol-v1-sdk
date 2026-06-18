/**
 * Asset-agnosticism, proven by wrapping the SDK's OWN object — end to end on
 * testnet. The protocol wraps any `key + store` asset; symmetric to the coin,
 * `integrate` needs only the object id of something the integrator owns and
 * derives the type from the object (no asset schema, no asset-type assumption).
 *
 * To stress it maximally we wrap a `UsufructCap` — a bearer object the SDK itself
 * mints — as a new escrow's asset. If anything were coupled to a specific asset
 * type (or to the SDK's own types), this would break.
 *
 *   ① MINT A CAP — integrate a DummyAsset escrow, rent it → UsufructCap X
 *   ② INTEGRATE  — wrap X (a UsufructCap) as a NEW escrow's asset (id only)
 *   ③ VERIFY     — the escrow's assetType IS the UsufructCap type; reads work
 *   ④ ROUND-TRIP — retire + claim → X comes back out, same id, intact
 *
 * Single actor (self-rent — permissionless). Run: `npm run asset`.
 */
import { Transaction } from '@mysten/sui/transactions';
import { coinTag, usufruct, type Market } from '@usufruct-protocol/sdk';
import { check, createdId, finish, loadSigner, makeClient, rateLimited, send } from './lib.js';

const DUMMY_PKG = '0xa72e830fcb3e688ab3c20ff3cbd0a149cd1b58715709905585e75eb18317a52a';
const DUMMY_COIN_PKG = '0x97fb7c77162e3edf6a44815ec9eb29b69f9a43747dfb1c1019a7fc5501e2ad96';
const DUMMY = coinTag({ type: `${DUMMY_COIN_PKG}::dummy_coin::DUMMY_COIN`, decimals: 9, symbol: 'DUMMY' });

const client = rateLimited(makeClient());
const ALICE = loadSigner();
const me = ALICE.toSuiAddress();

const MARKET: Market = {
  restPrice: DUMMY(0.01),
  tenure: '2m',
  multiTenure: false,
  creditShape: 'linear',
  auctionShape: 'linear',
  descent: 'off',
  handover: 'off',
  escalation: { fixed: DUMMY(0.001) },
  retireCommitment: 'immediate',
  ensembleCommitment: 'immediate',
};

async function mintAsset(): Promise<string> {
  const tx = new Transaction();
  tx.transferObjects([tx.moveCall({ target: `${DUMMY_PKG}::dummy_asset::mint` })], me);
  return createdId(await send(client, tx, ALICE), '::dummy_asset::DummyAsset');
}

async function main() {
  const u = usufruct({ network: 'testnet', client, signer: ALICE });

  // ════════════ ① MINT A CAP — rent a throwaway escrow to get a UsufructCap ════════════
  const { escrow: escrowA } = await u.integrate({ asset: await mintAsset(), coin: DUMMY, market: MARKET }).send();
  const capX = await escrowA.rent({ tenures: 1 }).send();
  console.log(`① minted a UsufructCap to wrap: ${capX.id}`);
  // sanity: capX is, on-chain, a UsufructCap object owned by us
  const capObj = await client.core.getObject({ objectId: capX.id });
  check('the object we will wrap is a UsufructCap (an SDK object)', capObj.object.type.includes('::usufruct_cap::UsufructCap'), capObj.object.type);

  // ════════════ ② INTEGRATE — wrap the UsufructCap as a new escrow's asset (id only) ════════════
  // The ONLY thing integrate is told about the asset is its id. No schema, no type.
  const { escrow: escrowB, governanceCap: govB } = await u.integrate({ asset: capX.id, coin: DUMMY, market: MARKET }).send();
  console.log(`\n② integrated escrow ${escrowB.id} wrapping the UsufructCap (passed by id only)`);

  // ════════════ ③ VERIFY — the escrow wrapped the SDK object; reads work ════════════
  check('escrow.assetType IS the UsufructCap type (no asset-type coupling)', escrowB.assetType.includes('::usufruct_cap::UsufructCap'), escrowB.assetType);
  check('the wrapped asset id == the UsufructCap id', (await escrowB.reader.assetId()) === capX.id, `${await escrowB.reader.assetId()}`);
  check('reads work for a non-DummyAsset escrow (status idle, floor == rest)', escrowB.status === 'idle' && escrowB.floorPrice.mist === DUMMY(0.01).mist, `${escrowB.status}/${escrowB.floorPrice}`);

  // ════════════ ④ ROUND-TRIP — retire + claim → the UsufructCap comes back intact ════════════
  await govB.retire(escrowB).send();
  const claimed = await govB.claim(escrowB).send();
  console.log(`\n④ claimed back: ${claimed.assetId}`);
  check('the claimed asset id == the original UsufructCap id (round-trip intact)', claimed.assetId === capX.id, claimed.assetId);
  const back = await client.core.getObject({ objectId: capX.id });
  check('it is a UsufructCap again, owned by us', back.object.type.includes('::usufruct_cap::UsufructCap') && JSON.stringify(back.object.owner).includes(me.slice(2)), JSON.stringify(back.object.owner));

  finish();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
