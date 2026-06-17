/**
 * The four hot paths, end to end on testnet — what *using* the protocol looks
 * like with the high-level API. This is a narrative, not a test: each section is
 * one thing a developer writes.
 *
 *   ① INTEGRATE  — list an asset as a rental market
 *   ② RENT       — acquire the right of use
 *   ③ BORROW     — inject your own PTB code around the borrowed asset
 *   ④ COLLECT    — take the earnings the market produced
 *
 * Two wallets: Alice (the market maker) and Bob (a renter). Run: `npm run demo`.
 */
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { coinTag, usufruct } from '@usufruct-protocol/sdk';
import { createdId, loadSigner, makeClient, rateLimited, send, waitForChainTime } from './lib.js';

// dummy axes (free mint) — stands in for "Alice's asset" and "the payment coin"
const DUMMY_PKG = '0xa72e830fcb3e688ab3c20ff3cbd0a149cd1b58715709905585e75eb18317a52a';
const DUMMY_COIN_PKG = '0x97fb7c77162e3edf6a44815ec9eb29b69f9a43747dfb1c1019a7fc5501e2ad96';
const DUMMY_COIN_TREASURY =
  '0xccee2bc2227913f441c7544892cf5d220880cbc0c55be8733b4b6777def976bc';
const DUMMY = coinTag({ type: `${DUMMY_COIN_PKG}::dummy_coin::DUMMY_COIN`, decimals: 9, symbol: 'DUMMY' });

const client = rateLimited(makeClient());

// ── boilerplate a real app would not write (wallets come from the user's keystore) ──
const ALICE = loadSigner(); // the market maker
const BOB = Ed25519Keypair.generate(); // a renter

async function setup(): Promise<string> {
  const tx = new Transaction();
  // mint Alice an asset to list…
  const sword = tx.moveCall({ target: `${DUMMY_PKG}::dummy_asset::mint` });
  tx.transferObjects([sword], ALICE.toSuiAddress());
  // …and fund Bob with gas + a payment coin
  tx.transferObjects([tx.splitCoins(tx.gas, [200_000_000n])[0]!], BOB.toSuiAddress());
  tx.transferObjects(
    [tx.moveCall({ target: `${DUMMY_COIN_PKG}::dummy_coin::mint`, arguments: [tx.object(DUMMY_COIN_TREASURY), tx.pure.u64(1_000_000_000n)] })],
    BOB.toSuiAddress(),
  );
  return createdId(await send(client, tx, ALICE), '::dummy_asset::DummyAsset');
}

async function main() {
  const swordId = await setup(); // the raw asset object id, before it's wrapped into an escrow

  // ════════════ ① INTEGRATE — Alice lists her asset as a rental market ════════════
  const alice = usufruct({ network: 'testnet', client, signer: ALICE });

  const { escrow, governanceCap, earningsInbox } = await alice.integrate({
    asset: swordId,
    coin: DUMMY, // the payment coin — an IMMUTABLE phantom type fixed here, never in the market
    // Every field is required — a market is a set of economic decisions, and the
    // API makes the governor reason about each one (no silent defaults).
    market: {
      // ── pricing & tenure ──
      restPrice: DUMMY(0.01), // costs 0.01 DUMMY per tenure
      tenure: '20s', // each tenure lasts 20s
      multiTenure: false, // one tenure at a time (no multi-tenure commitments)
      // ── dynamics ──
      creditShape: 'linear', //      how rent credit accrues over a tenure
      auctionShape: 'smoothstep', // how the floor drops in the post-tenancy Dutch auction
      descent: '10s', //             the auction window back down to the floor ('off' to disable)
      handover: '5s', //             a displaced renter keeps the asset this long ('off' / 'fullTenure')
      escalation: { fixed: DUMMY(0.001) }, // each new tenancy starts a bit higher
      // ── commitments (the governor binds its own hands) ──
      retireCommitment: 'immediate', //   may pull the asset anytime ({ deferredFor } to lock)
      ensembleCommitment: 'immediate', // may change the market anytime ({ deferredFor } to lock)
    },
  });
  console.log(`① listed ${escrow.id}`);
  console.log(`   floor ${escrow.floorPrice} · governanceCap ${governanceCap.capId} · earningsInbox ${earningsInbox.inboxId}\n`);

  // ════════════ ② RENT — Bob acquires the right of use ════════════
  const bob = usufruct({ network: 'testnet', client, signer: BOB });

  const sword = await bob.escrow(escrow.id); // an `Escrow` handle — Bob's typed view of the same market
  const cap = await sword.rent({ tenures: 1 });
  console.log(`② rented — usufructCap ${cap.id}`);
  console.log(`   paid ${cap.receipt!.paid} · until ${cap.receipt!.expiresAt.toISOString()}\n`);

  // ════════════ ③ BORROW — Bob injects his own PTB code around the asset ════════════
  const { digest } = await cap.borrow((asset, tx) => {
    // YOUR code, mid-PTB: the asset handle is yours to compose with any Sui call;
    // the borrow before and the return after are appended for you (guaranteed).
    const coupon = tx.moveCall({ target: `${DUMMY_PKG}::dummy_asset::use_asset`, arguments: [asset] });
    tx.transferObjects([coupon], BOB.toSuiAddress());
  });
  console.log(`③ borrowed → used → returned, one PTB · ${digest}\n`);

  // ════════════ ④ COLLECT — Alice collects what the market earned ════════════
  // Earnings settle when a tenancy ends. Wait for the tenure to expire, settle it
  // (permissionless), then collect from the EarningsInbox Alice holds.
  console.log('④ waiting for the tenure to expire, then settling…');
  await waitForChainTime(client, BigInt(cap.receipt!.expiresAt.getTime()));
  await sword.applyPendingTransitionStates(); // permissionless; the next rent would do it anyway
  const earned = await earningsInbox.collect();
  console.log(`   collected ${earned.map((e) => `${e.amount}`).join(', ') || '(nothing yet)'} from ${earningsInbox.inboxId}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
