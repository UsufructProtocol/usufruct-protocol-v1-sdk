/**
 * React to a TYPED event over gRPC — the push twin of `escrow.history()`. A
 * keeper subscribes to one event kind and gets it decoded, with its data, the
 * instant it lands. Here: wait for `BidPlaced` (a challenge), read the bid off the
 * typed event, then settle the handover.
 *
 *   ① INTEGRATE — Alice lists with a short handover
 *   ② RENT      — Bob occupies
 *   ③ ON        — keeper: `escrow.on('BidPlaced', ev => …)`  (typed event push)
 *   ④ CHALLENGE — Carol bids → the keeper's `BidPlaced` fires, with its data
 *   ⑤ REACT     — read pending_bid_amount/bidder off the event, settle the handover
 *
 * Run: `npm run watch:events`.
 */
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { coinTag, usufruct, type HistoryEvent, type Market } from '../src/index.js';
import { createdId, loadSigner, makeClient, rateLimited, send, waitForChainTime } from './lib.js';

const DUMMY_PKG = '0xa72e830fcb3e688ab3c20ff3cbd0a149cd1b58715709905585e75eb18317a52a';
const DUMMY_COIN_PKG = '0x97fb7c77162e3edf6a44815ec9eb29b69f9a43747dfb1c1019a7fc5501e2ad96';
const DUMMY_COIN_TREASURY =
  '0xccee2bc2227913f441c7544892cf5d220880cbc0c55be8733b4b6777def976bc';
const DUMMY = coinTag({ type: `${DUMMY_COIN_PKG}::dummy_coin::DUMMY_COIN`, decimals: 9, symbol: 'DUMMY' });

const client = rateLimited(makeClient());
const ALICE = loadSigner();
const me = ALICE.toSuiAddress();

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
  const { escrow } = await a.integrate({ asset: await mintAsset(), coin: DUMMY, market });
  console.log(`① listed ${escrow.id}`);

  const ub = usufruct({ network: 'testnet', client, signer: bob });
  await withRetry(async () => (await ub.escrow(escrow.id)).rent({ tenures: 1 }));
  console.log('② Bob rented — occupied\n');

  // ③ ON — the keeper subscribes to the typed BidPlaced event
  console.log("③ keeper: escrow.on('BidPlaced', …)  (typed event push over gRPC)");
  let resolveBid!: (ev: HistoryEvent) => void;
  const bidSeen = new Promise<HistoryEvent>((r) => (resolveBid = r));
  const stop = (await withRetry(() => a.escrow(escrow.id))).on('BidPlaced', (ev) => resolveBid(ev));

  // ④ CHALLENGE — Carol bids
  const uc = usufruct({ network: 'testnet', client, signer: carol });
  await withRetry(async () => (await uc.escrow(escrow.id)).rent({ tenures: 1 }));
  console.log('④ Carol bid on the occupied escrow\n');

  // ⑤ REACT — the typed event arrives with its data
  const bid = await bidSeen;
  stop();
  const d = bid.data as Record<string, unknown>;
  const bidderIsCarol = String(d['pending_usufructuary_address']) === carol.toSuiAddress();
  console.log(`⑤ keeper got a typed ${bid.kind} by ${String(bid.by).slice(0, 8)}:`);
  console.log(`   bidder = ${bidderIsCarol ? 'Carol' : d['pending_usufructuary_address']}`);
  console.log(`   pending_bid_amount = ${d['pending_bid_amount']} · floor_price = ${d['floor_price']}`);
  console.log(`   handover_countdown_expiry = ${d['handover_countdown_expiry']}`);
  console.log('   acting: settling the handover…');
  const challenged = await withRetry(() => a.escrow(escrow.id));
  await waitForChainTime(client, BigInt(challenged.handoverExpiresAt!.getTime()));
  await challenged.applyPendingTransitionStates();
  const after = await withRetry(() => a.escrow(escrow.id));
  console.log(`   settled — status=${after.status}`);
  console.log(
    after.status === 'occupied' && bidderIsCarol
      ? '\nALL PASS — keeper reacted to the typed BidPlaced and settled.'
      : '\nUNEXPECTED',
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
