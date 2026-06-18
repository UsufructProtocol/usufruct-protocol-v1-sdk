/**
 * Live smoke for the new views (next_boundary_ms / descent_expiry_ms) against the
 * freshly deployed package. Integrate + rent → occupied, then assert:
 *   - nextBoundaryAt() is some and equals expiresAt (the tenure end)
 *   - nextTransitionAt() is null (boundary not crossed → nothing overdue)
 *   - descentExpiresAt() is null in occupied (and crucially does NOT abort → the
 *     view exists on the deployed package)
 * Run: npx tsx scripts/check-next-boundary.ts
 */
import { Transaction } from '@mysten/sui/transactions';
import { coinTag, usufruct } from '@usufruct-protocol/sdk';
import { check, createdId, finish, loadSigner, makeClient, rateLimited, send, step } from './lib.js';

const DUMMY_PKG = '0xa72e830fcb3e688ab3c20ff3cbd0a149cd1b58715709905585e75eb18317a52a';
const DUMMY_COIN_PKG = '0x97fb7c77162e3edf6a44815ec9eb29b69f9a43747dfb1c1019a7fc5501e2ad96';
const DUMMY = coinTag({ type: `${DUMMY_COIN_PKG}::dummy_coin::DUMMY_COIN`, decimals: 9, symbol: 'DUMMY' });

const client = rateLimited(makeClient());
const me = loadSigner();

async function main() {
  step('integrate + rent on the new package');
  const tx = new Transaction();
  tx.transferObjects([tx.moveCall({ target: `${DUMMY_PKG}::dummy_asset::mint` })], me.toSuiAddress());
  const assetId = createdId(await send(client, tx, me), '::dummy_asset::DummyAsset');

  const u = usufruct({ client, signer: me });
  const { escrow } = await u
    .integrate({
      asset: assetId,
      coin: DUMMY,
      market: {
        restPrice: DUMMY(0.01), tenure: '60s', multiTenure: false,
        creditShape: 'linear', auctionShape: 'linear', descent: '20s', handover: '10s',
        escalation: { fixed: DUMMY(0.001) },
        retireCommitment: 'immediate', ensembleCommitment: 'immediate',
      },
    })
    .send();
  await u.escrow(escrow.id).then((e) => e.rent({ tenures: 1 }).send());
  console.log('   escrow', escrow.id);

  step('the new views, live');
  const e = await u.escrow(escrow.id);
  const nb = await e.nextBoundaryAt();
  const nt = await e.nextTransitionAt();
  const de = await e.descentExpiresAt();

  check('nextBoundaryAt() is some (occupied → tenure end)', nb != null, String(nb?.toISOString()));
  check('nextBoundaryAt() === expiresAt', nb?.getTime() === e.expiresAt?.getTime(), String(e.expiresAt?.toISOString()));
  check('nextTransitionAt() is null (boundary not crossed)', nt === null);
  check('descentExpiresAt() is null in occupied (and did NOT abort → view exists)', de === null);

  finish();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
