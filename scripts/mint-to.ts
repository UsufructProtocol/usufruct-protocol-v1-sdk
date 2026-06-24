/**
 * Live testnet validation of the `to` destinations on the minting writes
 * (`integrate` / `rent` / `claim`). The chain is the arbiter — we assert the
 * created owned objects land with the address we named, atomically, in the
 * SAME transaction (no second transfer).
 *
 *   ① integrate({ to: { governanceCap, earningsInbox } }) → each owned object to
 *      its named address; the Escrow is shared (no destination).
 *   ② integrate() with no `to` → both owned objects default to the sender.
 *   ③ rent({ to: buyer }) → the UsufructCap lands with `buyer`, paid by the sender.
 *   ④ retire + claim({ to: recipient }) → the unwrapped asset lands with `recipient`.
 *
 * Funder = loadSigner() (pays + governs). Recipients are fresh, UNFUNDED keypairs
 * (we transfer TO them). Dummy asset/coin are free-mint. Run: `npm run mint-to`.
 */
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { coinTag, usufruct, type Market } from '@usufruct-protocol/sdk';
import { check, createdId, finish, loadSigner, makeClient, rateLimited, send } from './lib.js';

const DUMMY_PKG = '0xa72e830fcb3e688ab3c20ff3cbd0a149cd1b58715709905585e75eb18317a52a';
const DUMMY_COIN_PKG = '0x97fb7c77162e3edf6a44815ec9eb29b69f9a43747dfb1c1019a7fc5501e2ad96';
const COIN_T = `${DUMMY_COIN_PKG}::dummy_coin::DUMMY_COIN`;
const DUMMY = coinTag({ type: COIN_T, decimals: 9, symbol: 'DUMMY_COIN' });

const client = rateLimited(makeClient());
const funder = loadSigner();
const me = funder.toSuiAddress();
const u = usufruct({ network: 'testnet', client, signer: funder });

const j = (x: unknown) => JSON.stringify(x, (_k, v: unknown) => (typeof v === 'bigint' ? `${v}` : v));
const ownerOf = async (objectId: string): Promise<string> =>
  j((await client.core.getObject({ objectId })).object.owner);
const ownedBy = (owner: string, addr: string) => owner.toLowerCase().includes(addr.slice(2).toLowerCase());

async function mintAsset(): Promise<string> {
  const tx = new Transaction();
  tx.transferObjects([tx.moveCall({ target: `${DUMMY_PKG}::dummy_asset::mint` })], me);
  return createdId(await send(client, tx, funder), '::dummy_asset::DummyAsset');
}

const market = (over: Partial<Market> = {}): Market => ({
  restPrice: DUMMY(0.01),
  tenure: '2m',
  multiTenure: true,
  creditShape: 'linear',
  auctionShape: 'linear',
  descent: 'off',
  handover: '25s',
  escalation: { fixed: DUMMY(0.001) },
  retireCommitment: 'immediate',
  ensembleCommitment: 'immediate',
  ...over,
});

async function main(): Promise<void> {
  // Fresh, unfunded recipients — pure destinations.
  const govDest = Ed25519Keypair.generate().toSuiAddress();
  const inboxDest = Ed25519Keypair.generate().toSuiAddress();
  const buyer = Ed25519Keypair.generate().toSuiAddress();
  const claimDest = Ed25519Keypair.generate().toSuiAddress();

  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n① integrate({ to: { governanceCap, earningsInbox } }) — split destinations');
  const r1 = await u.write
    .integrate({ asset: await mintAsset(), coin: DUMMY, market: market(), to: { governanceCap: govDest, earningsInbox: inboxDest } })
    .send();
  const govOwner = await ownerOf(r1.governanceCap.capId);
  const inboxOwner = await ownerOf(r1.earningsInbox.inboxId);
  const escrowOwner = await ownerOf(r1.escrow.id);
  check('GovernanceCap → govDest', ownedBy(govOwner, govDest), govOwner);
  check('EarningsInbox → inboxDest (distinct address)', ownedBy(inboxOwner, inboxDest), inboxOwner);
  check('the two owned objects went to DIFFERENT addresses', govDest !== inboxDest && !ownedBy(govOwner, inboxDest));
  check('Escrow is shared (no destination)', escrowOwner.toLowerCase().includes('shared'), escrowOwner);
  check('neither owned object stayed with the sender', !ownedBy(govOwner, me) && !ownedBy(inboxOwner, me));

  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n② integrate() — no `to` → both default to the sender');
  const r2 = await u.write.integrate({ asset: await mintAsset(), coin: DUMMY, market: market() }).send();
  check('GovernanceCap defaults to sender', ownedBy(await ownerOf(r2.governanceCap.capId), me));
  check('EarningsInbox defaults to sender', ownedBy(await ownerOf(r2.earningsInbox.inboxId), me));

  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n③ rent({ to: buyer }) — paid by the sender, cap to the buyer');
  const escrowHandle = await u.nav.escrow(r2.escrow.id); // an idle escrow the sender just listed
  const cap = await escrowHandle.write.rent({ tenures: 1, to: buyer }).send();
  const capOwner = await ownerOf(cap.id);
  check('UsufructCap → buyer', ownedBy(capOwner, buyer), capOwner);
  check('UsufructCap did NOT stay with the paying sender', !ownedBy(capOwner, me), capOwner);

  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n④ retire + claim({ to: recipient }) — unwrapped asset to a third party');
  const r4 = await u.write.integrate({ asset: await mintAsset(), coin: DUMMY, market: market() }).send();
  await r4.governanceCap.write.retire(r4.escrow).send();
  const claimed = await r4.governanceCap.write.claim(r4.escrow, { to: claimDest }).send();
  const assetOwner = await ownerOf(claimed.assetId);
  check('claimed asset → claimDest', ownedBy(assetOwner, claimDest), assetOwner);
  check('claimed asset did NOT stay with the governor', !ownedBy(assetOwner, me), assetOwner);

  finish();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
