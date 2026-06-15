/**
 * Live testnet validation of the Layer 2 Governor slice (Fase 20, Phase E).
 *
 * Drives the NEW supply-side API against testnet — the chain is the arbiter:
 *   u.integrate → readback → governor.update (immediate ok / deferred throws) →
 *   list/escrows → retire/claim → earnings.collect (coin-partitioned, §5.2).
 *
 * Funder = loadSigner(); an ephemeral Bob (funded from the funder) rents so the
 * inbox earns. Dummy asset/coin are free-mint. Run: `npm run governor`.
 */
import { bcs } from '@mysten/sui/bcs';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import * as actions from '../src/actions/index.js';
import { GRAPHQL_TESTNET, TESTNET } from '../src/config/network.js';
import { id } from '../src/primitives/brand.js';
import { CommittedEnsemble, coinTag, usufruct, type Market } from '../src/index.js';
import {
  check,
  createdId,
  finish,
  loadSigner,
  makeClient,
  rateLimited,
  send,
  sleep,
  step,
  waitForChainTime,
} from './lib.js';

const DUMMY_PKG = '0xa72e830fcb3e688ab3c20ff3cbd0a149cd1b58715709905585e75eb18317a52a';
const DUMMY_COIN_PKG = '0x97fb7c77162e3edf6a44815ec9eb29b69f9a43747dfb1c1019a7fc5501e2ad96';
const DUMMY_COIN_TREASURY =
  '0xccee2bc2227913f441c7544892cf5d220880cbc0c55be8733b4b6777def976bc';
const COIN_T = `${DUMMY_COIN_PKG}::dummy_coin::DUMMY_COIN`;
const dummyAssetSchema = bcs.struct('DummyAsset', { id: bcs.Address, uses: bcs.u64() });
const DUMMY = coinTag({ type: COIN_T, decimals: 9, symbol: 'DUMMY_COIN' });

const client = rateLimited(makeClient());
const funder = loadSigner();
const me = funder.toSuiAddress();

/** BigInt-safe JSON (for check() detail strings). */
const j = (x: unknown) => JSON.stringify(x, (_k, v: unknown) => (typeof v === 'bigint' ? `${v}` : v));

/** Retry transient public-fullnode flakiness (truncated devInspect, timeouts). */
async function withRetry<T>(label: string, fn: () => Promise<T>, tries = 5): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const msg = String(e);
      const transient = /no results|devInspect|dryRun|429|TIMEOUT|ECONNRESET|fetch failed/i.test(msg);
      if (!transient || i >= tries - 1) throw e;
      const wait = 4_000 * (i + 1);
      console.log(`  [retry] ${label} in ${wait}ms — ${msg.slice(0, 70)}`);
      await sleep(wait);
    }
  }
}

const u = usufruct({ client, signer: funder, assetSchema: dummyAssetSchema, graphql: GRAPHQL_TESTNET });

/** Mint a DummyAsset to the funder; return its object id. */
async function mintAsset(): Promise<string> {
  const tx = new Transaction();
  tx.transferObjects([tx.moveCall({ target: `${DUMMY_PKG}::dummy_asset::mint` })], me);
  return createdId(await send(client, tx, funder), '::dummy_asset::DummyAsset');
}

const market = (over: Partial<Market> = {}): Market => ({
  restPrice: DUMMY(0.01),
  tenure: '2m',
  coin: DUMMY,
  multiTenure: true,
  handover: '25s',
  retireCommitment: 'immediate',
  ensembleCommitment: 'immediate',
  ...over,
});

async function main() {
  console.log(`funder ${me}`);

  step('1. integrate (new API) — mints THREE independent objects');
  const { escrow, governanceCap, earnings } = await u.integrate({ asset: await mintAsset(), market: market() });
  check('escrow created', escrow.id.length === 66, escrow.id);
  check('governance cap (object) surfaced', governanceCap.capId.length === 66, governanceCap.capId);
  check('earnings inbox (separate object) surfaced', earnings.inboxId.length === 66, earnings.inboxId);
  const rp = await escrow.reader.restPrice();
  check('market readback: restPrice == 0.01 DUMMY', rp.kind === 'fixed' && rp.priceMist === 10_000_000n, j(rp));

  step('2. governanceCap.update — immediate commitment lets the price change');
  await governanceCap.update(escrow, market({ restPrice: DUMMY(0.02) }));
  const rp2 = await (await u.escrow(escrow.id)).reader.restPrice();
  check('restPrice updated to 0.02 DUMMY', rp2.kind === 'fixed' && rp2.priceMist === 20_000_000n, j(rp2));

  step('2b. governanceCap.update — a deferred ensemble commitment is enforced (throws)');
  const b = await u.integrate({ asset: await mintAsset(), market: market({ ensembleCommitment: { deferredFor: '1h' } }) });
  let threw = false;
  try {
    await b.governanceCap.update(b.escrow, market({ restPrice: DUMMY(0.05) }));
  } catch (e) {
    threw = e instanceof CommittedEnsemble;
  }
  check('update before the ensemble commitment elapses throws CommittedEnsemble', threw);

  step('3. portfolio — list a second escrow under the same cap, naming the inbox');
  const listed = await governanceCap.list(await mintAsset(), market(), { earnings: earnings.inboxId });
  check('portfolio escrow listed', listed.id.length === 66, listed.id);
  // Portfolio proof (cheap + deterministic): both escrows name the SAME cap.
  const govA = (await withRetry('read escrowA', () => u.escrow(escrow.id))).governanceCapId;
  const govL = (await withRetry('read listed', () => u.escrow(listed.id))).governanceCapId;
  check('both escrows are governed by the same cap (portfolio)', govA === governanceCap.capId && govL === governanceCap.capId, `${govA} / ${govL}`);

  step('4. retire + claim — pull an idle asset back out');
  const r = await u.integrate({ asset: await mintAsset(), market: market() });
  await r.governanceCap.retire(r.escrow);
  const claimed = await r.governanceCap.claim(r.escrow);
  check('claim returned the asset id', claimed.assetId.length === 66, claimed.assetId);
  const owner = (await client.core.getObject({ objectId: claimed.assetId })).object.owner;
  check('claimed asset is owned by the funder', j(owner).includes(me.slice(2)), j(owner));

  step('5. earnings — Bob rents a short-tenure escrow; tenure expires; collect (§5.2)');
  // handover must not exceed the tenure (new_ensemble aborts otherwise), so the
  // short-tenure escrow uses a short handover too.
  const e = await u.integrate({ asset: await mintAsset(), market: market({ tenure: '15s', handover: '5s' }) });
  // fund an ephemeral Bob (SUI gas + DUMMY) from the funder
  const bob = Ed25519Keypair.generate();
  {
    const tx = new Transaction();
    tx.transferObjects([tx.splitCoins(tx.gas, [200_000_000n])[0]!], bob.toSuiAddress());
    tx.transferObjects(
      [tx.moveCall({ target: `${DUMMY_COIN_PKG}::dummy_coin::mint`, arguments: [tx.object(DUMMY_COIN_TREASURY), tx.pure.u64(1_000_000_000n)] })],
      bob.toSuiAddress(),
    );
    await send(client, tx, funder);
  }
  const ub = usufruct({ client, signer: bob, assetSchema: dummyAssetSchema });
  const sword = await withRetry('Bob reads escrow', () => ub.escrow(e.escrow.id));
  const cap = await sword.rent({ tenures: 1, payment: ub.fromBalance(DUMMY) });
  const expiry = BigInt(cap.receipt!.expiresAt.getTime());
  await waitForChainTime(client, expiry);
  // apply the lazy tenure-expiry → posts an EarningsMessage to the inbox
  const tx = new Transaction();
  actions.applyPendingTransitionStates().toPtb(tx, { pkg: TESTNET, escrowId: id<'Escrow'>(e.escrow.id), typeArguments: [e.escrow.assetType, e.escrow.coinType] });
  await send(client, tx, funder);

  const pending = await e.earnings.balance();
  const collected = await e.earnings.collect();
  const dummyPending = pending.find((p) => p.coin.includes('dummy_coin'))?.amount.mist ?? 0n;
  const dummyCollected = collected.find((c) => c.coin.includes('dummy_coin'))?.amount.mist ?? 0n;
  check('earnings collected > 0', dummyCollected > 0n, `${collected.map((c) => `${c.amount}`).join(', ')}`);
  check('balance() preview == collect() (conservation per coin)', dummyPending === dummyCollected, `pending=${dummyPending} collected=${dummyCollected}`);

  step('6. OBJECT-CENTRIC PROOF — transfer the GovernanceCap; governance follows the object');
  const t = await u.integrate({ asset: await mintAsset(), market: market() });
  const carol = Ed25519Keypair.generate();
  {
    const tx = new Transaction(); // fund Carol with gas so she can sign
    tx.transferObjects([tx.splitCoins(tx.gas, [100_000_000n])[0]!], carol.toSuiAddress());
    await send(client, tx, funder);
  }
  // the funder (current holder) hands governance to Carol — the cap is a bearer object
  await t.governanceCap.transfer(carol.toSuiAddress());
  // Carol, now holding the cap, governs (she never called integrate):
  const uc = usufruct({ client, signer: carol, assetSchema: dummyAssetSchema });
  await uc.governanceCap(t.governanceCap.capId).update(t.escrow.id, market({ restPrice: DUMMY(0.03) }));
  const rpC = await withRetry('readback after Carol governs', () => u.escrow(t.escrow.id).then((x) => x.reader.restPrice()));
  check('the NEW holder (Carol) governs — update applied', rpC.kind === 'fixed' && rpC.priceMist === 30_000_000n, j(rpC));
  // the funder, no longer holding the cap, cannot govern:
  let funderBlocked = false;
  try {
    await u.governanceCap(t.governanceCap.capId).update(t.escrow.id, market({ restPrice: DUMMY(0.04) }));
  } catch {
    funderBlocked = true;
  }
  check('the FORMER holder (funder) can no longer govern — the role left with the object', funderBlocked);

  finish();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
