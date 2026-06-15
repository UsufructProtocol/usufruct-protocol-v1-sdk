/**
 * The governor's lifecycle, end to end on testnet — what running a market over
 * time looks like with the high-level API. Narrative, not a test. One wallet
 * (the governor / market maker). Run: `npm run lifecycle`.
 *
 *   ① INTEGRATE  — list an asset, set the market
 *   ② ADJUST     — change the rest price (update the ensemble)
 *   ③ COMMIT     — bind your own hands (lock the market for a while)
 *   ④ RETIRE     — pull the asset out of the market
 *   ⑤ CLAIM      — take the asset back
 */
import { Transaction } from '@mysten/sui/transactions';
import { CommittedEnsemble, coinTag, usufruct, type Market } from '../src/index.js';
import { createdId, loadSigner, makeClient, rateLimited, send } from './lib.js';

const DUMMY_PKG = '0xa72e830fcb3e688ab3c20ff3cbd0a149cd1b58715709905585e75eb18317a52a';
const DUMMY_COIN_PKG = '0x97fb7c77162e3edf6a44815ec9eb29b69f9a43747dfb1c1019a7fc5501e2ad96';
const DUMMY = coinTag({ type: `${DUMMY_COIN_PKG}::dummy_coin::DUMMY_COIN`, decimals: 9, symbol: 'DUMMY' });

const client = rateLimited(makeClient());
const GOV = loadSigner();
const me = GOV.toSuiAddress();

async function mintAsset(): Promise<string> {
  const tx = new Transaction();
  tx.transferObjects([tx.moveCall({ target: `${DUMMY_PKG}::dummy_asset::mint` })], me);
  return createdId(await send(client, tx, GOV), '::dummy_asset::DummyAsset');
}

async function main() {
  const swordId = await mintAsset();
  const u = usufruct({ network: 'testnet', client, signer: GOV });

  // ════════════ ① INTEGRATE — list the asset, set the market ════════════
  const market: Market = {
    restPrice: DUMMY(0.01),
    tenure: '1h',
    coin: DUMMY,
    multiTenure: false,
    creditShape: 'linear',
    auctionShape: 'linear',
    descent: 'off',
    handover: 'off',
    // NOTE (ceremony found): there is no `escalation: 'off'` — and a 0 delta aborts
    // on-chain (price_escalation_policy::new_fixed_delta). So "no escalation" can't
    // be said cleanly; you must pass a magic tiny nonzero.
    escalation: { fixed: DUMMY(0.0001) },
    retireCommitment: 'immediate', // I can pull the asset anytime
    ensembleCommitment: 'immediate', // I can change the market anytime (for now)
  };
  const { escrow, governanceCap } = await u.integrate({ asset: swordId, market });
  console.log(`① listed ${escrow.id} — floor ${escrow.floorPrice}, cap ${governanceCap.capId}\n`);

  // ════════════ ② ADJUST — bump the rest price ════════════
  // ⚠ CEREMONY: to change ONE field I must re-state the WHOLE market (every field
  //   is required). I spread the prior `market` and override `restPrice`.
  await governanceCap.update(escrow, { ...market, restPrice: DUMMY(0.02) });
  console.log(`② adjusted — floor is now ${await escrow.reader.restPrice().then((r) => (r.kind === 'fixed' ? r.priceMist : '?'))} mist\n`);

  // ════════════ ③ COMMIT — bind my own hands so renters can trust the market ════════════
  await governanceCap.extendEnsembleCommitment(escrow, { deferredFor: '7d' });
  // now the market is locked for 7 days — a further price change is rejected:
  let locked = false;
  try {
    await governanceCap.update(escrow, { ...market, restPrice: DUMMY(0.05) });
  } catch (e) {
    locked = e instanceof CommittedEnsemble;
  }
  console.log(`③ committed — market locked for 7d; a price change is now ${locked ? 'rejected (CommittedEnsemble)' : 'NOT rejected?!'}\n`);

  // ════════════ ④ RETIRE — pull the asset out of the market ════════════
  // (retireCommitment was 'immediate', so this is allowed even while the ensemble is locked)
  await governanceCap.retire(escrow);
  console.log(`④ retired ${escrow.id}\n`);

  // ════════════ ⑤ CLAIM — take the asset back ════════════
  const { assetId } = await governanceCap.claim(escrow);
  const owner = (await client.core.getObject({ objectId: assetId })).object.owner;
  console.log(`⑤ claimed — asset ${assetId} back to ${JSON.stringify(owner)}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
