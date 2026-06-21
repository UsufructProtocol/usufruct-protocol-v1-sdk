/**
 * `u.batch(...)` — several writes in ONE atomic transaction, end to end on testnet.
 *
 * The canonical use: atomic governance. A governor changes the market on two
 * escrows in a single PTB — `u.batch(govA.updateMarket(...), govB.updateMarket(...))
 * .send()`. One `.send()`, one transaction, all-or-nothing. Run: `npm run demo:batch`.
 *
 * Note on decode: batch is exact for digest-only writes (governance, transfer,
 * collect) and for writes that create *distinct* object types. Batching several
 * writes that mint the *same* type (e.g. two `rent`s) executes correctly — the tx
 * is atomic and both objects are created — but the SDK cannot attribute each
 * created object to its plan from the shared effects, so the returned handles
 * collide. For those, use separate `.send()`s (or re-fetch by id).
 */
import { Transaction } from '@mysten/sui/transactions';
import { coinTag, usufruct } from '@usufruct-protocol/sdk';
import { loadSigner, makeClient, rateLimited, send } from './lib.js';
import { DUMMY_PKG } from './recipes/dummy-asset.js';

const DUMMY_COIN_PKG = '0x97fb7c77162e3edf6a44815ec9eb29b69f9a43747dfb1c1019a7fc5501e2ad96';
const DUMMY = coinTag({ type: `${DUMMY_COIN_PKG}::dummy_coin::DUMMY_COIN`, decimals: 9, symbol: 'DUMMY' });

const client = rateLimited(makeClient());
const ALICE = loadSigner();

const MARKET = {
  restPrice: DUMMY(0.01),
  tenure: '60s',
  multiTenure: false,
  creditShape: 'linear',
  auctionShape: 'smoothstep',
  descent: '10s',
  handover: 'off',
  escalation: { fixed: DUMMY(0.001) },
  retireCommitment: 'immediate',
  ensembleCommitment: 'immediate',
} as const;

async function setup(): Promise<[string, string]> {
  const tx = new Transaction();
  const a1 = tx.moveCall({ target: `${DUMMY_PKG}::dummy_asset::mint` });
  const a2 = tx.moveCall({ target: `${DUMMY_PKG}::dummy_asset::mint` });
  tx.transferObjects([a1, a2], ALICE.toSuiAddress());
  const res = await send(client, tx, ALICE);
  const created = res.effects!.changedObjects!
    .filter((c) => c.idOperation === 'Created' && res.objectTypes?.[c.objectId]?.includes('::dummy_asset::DummyAsset'))
    .map((c) => c.objectId);
  return [created[0]!, created[1]!];
}

async function main() {
  const [asset1, asset2] = await setup();
  const u = usufruct({ network: 'testnet', client, signer: ALICE });

  const r1 = await u.write.integrate({ asset: asset1, coin: DUMMY, market: MARKET }).send();
  const r2 = await u.write.integrate({ asset: asset2, coin: DUMMY, market: MARKET }).send();
  console.log(`listed ${r1.escrow.id} and ${r2.escrow.id}\n`);

  // Two market changes, ONE atomic transaction — one .send(), all-or-nothing.
  const [a, b] = await u
    .batch(
      r1.governanceCap.write.updateMarket(r1.escrow, { restPrice: DUMMY(0.02) }),
      r2.governanceCap.write.updateMarket(r2.escrow, { restPrice: DUMMY(0.03) }),
    )
    .send();

  console.log('u.batch(govA.updateMarket, govB.updateMarket).send() →');
  console.log(`   digest A ${a.digest}`);
  console.log(`   digest B ${b.digest}`);
  console.log(`   atomic: ${a.digest === b.digest ? 'same tx ✓' : 'DIFFERENT TX ✗'}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
