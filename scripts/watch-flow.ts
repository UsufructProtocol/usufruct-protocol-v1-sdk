/**
 * Watch — react to events live. A keeper waits for something to happen on an
 * escrow and acts the moment it does. Here: wait for a CHALLENGE (a bid against
 * the sitting tenant → `demand`), then settle the handover when its window closes.
 *
 *   ① INTEGRATE — Alice lists with a short handover window
 *   ② RENT      — Bob takes it (occupied)
 *   ③ WATCH     — a keeper: `escrow.waitFor(e => e.isChallenged)` (running, not awaited)
 *   ④ CHALLENGE — Carol rents the occupied escrow = the bid (→ demand)
 *   ⑤ REACT     — the keeper's wait resolves; it reads the challenger and, once the
 *                 handover window passes, settles → Carol active, Bob displaced
 *
 * Run: `npm run watch`.
 */
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { coinTag, usufruct, type Market } from '@usufruct-protocol/sdk';
import { createdId, loadSigner, makeClient, rateLimited, send, waitForChainTime } from './lib.js';

const DUMMY_PKG = '0xa72e830fcb3e688ab3c20ff3cbd0a149cd1b58715709905585e75eb18317a52a';
const DUMMY_COIN_PKG = '0x97fb7c77162e3edf6a44815ec9eb29b69f9a43747dfb1c1019a7fc5501e2ad96';
const DUMMY_COIN_TREASURY =
  '0xccee2bc2227913f441c7544892cf5d220880cbc0c55be8733b4b6777def976bc';
const DUMMY = coinTag({ type: `${DUMMY_COIN_PKG}::dummy_coin::DUMMY_COIN`, decimals: 9, symbol: 'DUMMY' });

const client = rateLimited(makeClient());
const ALICE = loadSigner();
const me = ALICE.toSuiAddress();

/** Retry the public-fullnode read flake (truncated devInspect surfaces as either). */
async function withRetry<T>(fn: () => Promise<T>, tries = 5): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const transient = /no results|devInspect|returnValues|Cannot read properties|429|fetch failed/i.test(String(e));
      if (!transient || i >= tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 2500 * (i + 1)));
    }
  }
}

async function newRenter(): Promise<Ed25519Keypair> {
  const kp = Ed25519Keypair.generate();
  const tx = new Transaction();
  tx.transferObjects([tx.splitCoins(tx.gas, [60_000_000n])[0]!], kp.toSuiAddress());
  tx.transferObjects(
    [tx.moveCall({ target: `${DUMMY_COIN_PKG}::dummy_coin::mint`, arguments: [tx.object(DUMMY_COIN_TREASURY), tx.pure.u64(1_000_000_000n)] })],
    kp.toSuiAddress(),
  );
  await send(client, tx, ALICE);
  return kp;
}

async function mintAsset(): Promise<string> {
  const tx = new Transaction();
  tx.transferObjects([tx.moveCall({ target: `${DUMMY_PKG}::dummy_asset::mint` })], me);
  return createdId(await send(client, tx, ALICE), '::dummy_asset::DummyAsset');
}

async function main() {
  const [bob, carol] = [await newRenter(), await newRenter()];

  // ① INTEGRATE — short handover so the challenge resolves quickly
  const market: Market = {
    restPrice: DUMMY(0.01),
    tenure: '5m',
    multiTenure: false,
    creditShape: 'linear',
    auctionShape: 'linear',
    descent: 'off',
    handover: '15s',
    escalation: { fixed: DUMMY(0.001) },
    retireCommitment: 'immediate',
    ensembleCommitment: 'immediate',
  };
  const a = usufruct({ network: 'testnet', client, signer: ALICE });
  const { escrow } = await a.write.integrate({ asset: await mintAsset(), coin: DUMMY, market }).send();
  console.log(`① listed ${escrow.id}`);

  // ② RENT — Bob occupies
  const ub = usufruct({ network: 'testnet', client, signer: bob });
  await withRetry(async () => (await ub.nav.escrow(escrow.id)).write.rent({ tenures: 1 }).send());
  console.log('② Bob rented — occupied\n');

  // ③ WATCH — the keeper starts waiting for a challenge (do NOT await yet)
  console.log('③ keeper watching for a challenge (escrow.react.waitFor(async e => (await e.read.assetState()).kind === "demand"))…');
  const keeper = withRetry(() => a.nav.escrow(escrow.id)).then((e) =>
    e.react.waitFor(async (s) => (await s.read.assetState()).kind === 'demand', { timeoutMs: 120_000 }),
  );

  // ④ CHALLENGE — Carol bids on the occupied escrow
  const uc = usufruct({ network: 'testnet', client, signer: carol });
  await withRetry(async () => (await uc.nav.escrow(escrow.id)).write.rent({ tenures: 1 }).send());
  console.log('④ Carol bid on the occupied escrow (the challenge)\n');

  // ⑤ REACT — the keeper's wait resolves the moment the state turns to demand
  const challenged = await keeper;
  const challengedState = await challenged.read.assetState();
  const challenger = challengedState.kind === 'demand' ? challengedState.challenger : undefined;
  const handoverExpiresAt = challengedState.kind === 'demand' ? challengedState.handoverExpiresAt : undefined;
  const pendingIsCarol = challenger === carol.toSuiAddress();
  console.log(`⑤ keeper reacted — status=${challengedState.kind}, challenger=${pendingIsCarol ? 'Carol' : challenger}`);
  console.log(`   acting: waiting out the handover (until ${handoverExpiresAt?.toISOString()}), then settling…`);
  await waitForChainTime(client, BigInt(handoverExpiresAt!.getTime()));
  await challenged.write.applyPendingTransitionStates().send();
  const after = await withRetry(() => a.nav.escrow(escrow.id));
  const afterState = await after.read.assetState();
  console.log(`   settled — status=${afterState.kind}; active cap = ${(await after.read.activeUsufructCapId())?.slice(0, 12)}…`);
  console.log(afterState.kind === 'occupied' ? '\nALL PASS — keeper waited, reacted, settled.' : '\nUNEXPECTED');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
