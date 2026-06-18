/**
 * PROBE B — keeper / settler bot: how do `subscribe` (events) and TIME interact?
 *
 * State transitions in Usufruct are LAZY: a tenure expiring, a handover window
 * closing — none of these is an on-chain event by itself. The chain only advances
 * when *some write touches the escrow*, and EVERY write (`rent`, `bid`, `borrow`,
 * `collect`, …) calls `apply` internally first. So:
 *
 *   • Under activity the system is SELF-MAINTAINING — the next organic tx flushes
 *     any due transition. A keeper is NOT required.
 *   • `applyPendingTransitionStates` is the only write whose *sole* job is to flush.
 *     A keeper exists purely for TIMELINESS in QUIET windows (a boundary passes and
 *     nobody is interacting).
 *
 * Therefore a keeper needs TWO signals, and the SDK already exposes both:
 *   • event-driven — `escrow.watch(cb)` fires on a version change (a rent/bid, or
 *     the apply that flushes a queued event). It does NOT fire when wall-clock time
 *     merely crosses a boundary.
 *   • time-driven  — `escrow.nextBoundaryAt()` returns the next FUTURE boundary
 *     (tenure / handover / auction descent end) as a `Date` on the CHAIN clock. The
 *     keeper schedules on that, applies, and the apply flushes the lazy event.
 *     (`nextTransitionAt()` is the wrong tool here — it is null until a transition
 *     is already overdue; see the README.)
 *
 * This runs one keeper over one escrow's whole lifecycle, acting in two quiet
 * windows: ② the challenge handover, then ③ the tenure expiry — each time the
 * keeper's `apply` is the ONLY write that advances the state.
 *
 * Run from the monorepo root:  npx tsx examples/keeper-bot/index.ts
 */
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { coinTag, usufruct, type Market } from '@usufruct-protocol/sdk';
import { check, createdId, finish, loadSigner, makeClient, rateLimited, send, sleep, step, waitForChainTime } from '../../scripts/lib.js';

const POLL_MS = 1000; // the watch poll cadence; drain one+ interval before measuring

const DUMMY_PKG = '0xa72e830fcb3e688ab3c20ff3cbd0a149cd1b58715709905585e75eb18317a52a';
const DUMMY_COIN_PKG = '0x97fb7c77162e3edf6a44815ec9eb29b69f9a43747dfb1c1019a7fc5501e2ad96';
const DUMMY_COIN_TREASURY = '0xccee2bc2227913f441c7544892cf5d220880cbc0c55be8733b4b6777def976bc';
const DUMMY = coinTag({ type: `${DUMMY_COIN_PKG}::dummy_coin::DUMMY_COIN`, decimals: 9, symbol: 'DUMMY' });

const client = rateLimited(makeClient());
const ALICE = loadSigner(); // operator + stands in as the keeper (apply is permissionless)

// how many times the version-driven subscription fired (the EVENT signal).
let watchFires = 0;

/** Fund a fresh renter: gas + DUMMY. */
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
  tx.transferObjects([tx.moveCall({ target: `${DUMMY_PKG}::dummy_asset::mint` })], ALICE.toSuiAddress());
  return createdId(await send(client, tx, ALICE), '::dummy_asset::DummyAsset');
}

/**
 * THE KEEPER'S CORE — wait until the escrow's next transition boundary (CHAIN
 * time), then apply it. The assertion proves the temporal point: across the wait,
 * the version-driven `watch` does NOT fire — the boundary is invisible to events
 * until the keeper's own `apply` flushes it.
 */
async function settleAtNextBoundary(u: ReturnType<typeof usufruct>, escrowId: string, label: string) {
  let e = await u.escrow(escrowId);
  // The scheduling oracle: the next FUTURE boundary across all phases (tenure end /
  // handover end / auction descent end), via the on-chain `next_boundary_ms` view.
  // (This used to compose `handoverExpiresAt ?? expiresAt` by hand — blind in
  // descent; `nextBoundaryAt()` covers it, drift-zero. NOT `nextTransitionAt()`,
  // which is null until a transition is already overdue.)
  const at = await e.nextBoundaryAt();
  if (!at) {
    console.log(`   [keeper] ${label}: no boundary on this phase (status=${e.status})`);
    return e;
  }
  console.log(`   [keeper] ${label}: next boundary ${at.toISOString()} — sleeping on the CHAIN clock…`);
  // Drain the poller: `watch` lags writes by up to one interval, so let any
  // in-flight delivery for the CURRENT phase land before we measure silence.
  await sleep(POLL_MS * 2);
  const firesBefore = watchFires;
  await waitForChainTime(client, BigInt(at.getTime()));
  const quietAcrossBoundary = watchFires === firesBefore; // no event fired as time crossed it
  console.log(`   [keeper] ${label}: boundary passed; watch fired during the wait? ${watchFires - firesBefore} times`);
  await e.applyPendingTransitionStates().send(); // the ONLY write in the quiet window
  e = await u.escrow(escrowId);
  console.log(`   [keeper] ${label}: applied → status=${e.status}`);
  check(`${label}: subscribe stayed silent across the wall-clock boundary`, quietAcrossBoundary);
  return e;
}

async function main() {
  const [bob, carol] = [await newRenter(), await newRenter()];

  step('① integrate — short tenure (30s) + short handover (10s), no auction');
  const market: Market = {
    restPrice: DUMMY(0.01),
    tenure: '30s',
    multiTenure: false,
    creditShape: 'linear',
    auctionShape: 'linear',
    descent: 'off',
    handover: '10s',
    escalation: { fixed: DUMMY(0.001) },
    retireCommitment: 'immediate',
    ensembleCommitment: 'immediate',
  };
  const a = usufruct({ network: 'testnet', client, signer: ALICE });
  const { escrow } = await a.integrate({ asset: await mintAsset(), coin: DUMMY, market }).send();
  console.log('   escrow', escrow.id);

  // the EVENT signal: watch fires on every on-chain CHANGE (version bump), and only then.
  const stopWatch = (await a.escrow(escrow.id)).watch(
    (e) => {
      watchFires += 1;
      console.log(`   [watch] on-chain change #${watchFires} → status=${e.status}`);
    },
    { intervalMs: POLL_MS },
  );

  step('② occupy + challenge (organic writes — each self-applies)');
  await usufruct({ client, signer: bob }).escrow(escrow.id).then((e) => e.rent({ tenures: 1 }).send());
  console.log('   Bob rented → occupied');
  await usufruct({ client, signer: carol }).escrow(escrow.id).then((e) => e.rent({ tenures: 1 }).send());
  console.log('   Carol bid on the occupied escrow → demand (handover window open)');

  step('③ KEEPER, quiet window #1 — the challenge handover');
  const settled = await settleAtNextBoundary(a, escrow.id, 'handover');
  const carolActive = settled.activeUsufructCapId != null && settled.status === 'occupied';
  check('handover settled by the keeper → challenger now active (occupied)', carolActive, settled.status);

  step('④ KEEPER, quiet window #2 — the tenure expiry');
  const released = await settleAtNextBoundary(a, escrow.id, 'tenure');
  check('tenure expiry settled by the keeper → seat released (idle)', released.status === 'idle', released.status);

  stopWatch();
  console.log(`\nwatch fired ${watchFires}× total — once per organic write + once per keeper apply, never on a bare clock tick.`);
  finish();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
