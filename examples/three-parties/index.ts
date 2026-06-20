/**
 * PROBE — the three parties of a settlement, each read from events.
 *
 * Every settlement splits three ways: the governor (earnings), the protocol (fee), and
 * the renter (what's left of the stake). This session gave the first two event-sourced
 * ledgers (inbox.totals()); this closes the set with the renter's and two attribution
 * views, all drift-zero from the log:
 *
 *   usufructCap.statement()        — the renter's P&L (paid / refunded / consumed)
 *   escrow.tenancies()             — the asset's occupancy ledger, per-tenancy economics
 *   governanceCap.revenueByEscrow()— the governor's earnings attributed per asset
 *
 * It drives one displacement (so the renter statement shows a real refund): Alice rents
 * A, Bob outbids her, the handover window closes part-way through Alice's tenure → Alice
 * is displaced with a partial refund. A second escrow B (plain rent→expiry) gives
 * revenueByEscrow two assets to attribute.
 *
 * Run from the monorepo root:  npx tsx examples/three-parties/index.ts
 */
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { coinTag, usufruct, type UsufructCap } from '@usufruct-protocol/sdk';
import { GRAPHQL_TESTNET } from '@usufruct-protocol/sdk/config/network.js';
import {
  check, createdId, finish, loadSigner, makeClient, rateLimited, send, step, waitForChainTime,
} from '../../scripts/lib.js';

const DUMMY_PKG = '0xa72e830fcb3e688ab3c20ff3cbd0a149cd1b58715709905585e75eb18317a52a';
const DUMMY_COIN_PKG = '0x97fb7c77162e3edf6a44815ec9eb29b69f9a43747dfb1c1019a7fc5501e2ad96';
const DUMMY_COIN_TREASURY = '0xccee2bc2227913f441c7544892cf5d220880cbc0c55be8733b4b6777def976bc';
const DUMMY = coinTag({ type: `${DUMMY_COIN_PKG}::dummy_coin::DUMMY_COIN`, decimals: 9, symbol: 'DUMMY' });

const client = rateLimited(makeClient());
const alice = loadSigner();

async function mintAsset(): Promise<string> {
  const tx = new Transaction();
  tx.transferObjects([tx.moveCall({ target: `${DUMMY_PKG}::dummy_asset::mint` })], alice.toSuiAddress());
  return createdId(await send(client, tx, alice), '::dummy_asset::DummyAsset');
}

async function fundBob(): Promise<Ed25519Keypair> {
  const kp = Ed25519Keypair.generate();
  const tx = new Transaction();
  tx.transferObjects([tx.splitCoins(tx.gas, [60_000_000n])[0]!], kp.toSuiAddress());
  tx.transferObjects(
    [tx.moveCall({ target: `${DUMMY_COIN_PKG}::dummy_coin::mint`, arguments: [tx.object(DUMMY_COIN_TREASURY), tx.pure.u64(2_000_000_000n)] })],
    kp.toSuiAddress(),
  );
  await send(client, tx, alice);
  return kp;
}

/** Poll out of GraphQL indexing lag until `ready`. */
async function until<T>(f: () => Promise<T>, ready: (v: T) => boolean): Promise<T> {
  for (let i = 0; i < 18; i++) {
    const v = await f();
    if (ready(v)) return v;
    await new Promise((r) => setTimeout(r, 5000));
  }
  return f();
}

async function main() {
  const u = usufruct({ client, signer: alice, graphql: GRAPHQL_TESTNET });

  step('list A (tenure 40s, handover 10s → displacement mid-tenure) + B in the same portfolio');
  const { escrow: A, governanceCap, earningsInbox } = await u
    .integrate({
      asset: await mintAsset(), coin: DUMMY,
      market: {
        restPrice: DUMMY(0.01), tenure: '40s', multiTenure: false,
        creditShape: 'linear', auctionShape: 'linear', descent: 'off', handover: '10s',
        escalation: { fixed: DUMMY(0.001) }, retireCommitment: 'immediate', ensembleCommitment: 'immediate',
      },
    })
    .send();
  const B = await governanceCap
    .integrateIntoPortfolio(await mintAsset(), DUMMY, {
      restPrice: DUMMY(0.01), tenure: '15s', multiTenure: false,
      creditShape: 'linear', auctionShape: 'linear', descent: 'off', handover: 'off',
      escalation: { fixed: DUMMY(0.001) }, retireCommitment: 'immediate', ensembleCommitment: 'immediate',
    }, { earningsInbox: earningsInbox.inboxId })
    .send();

  const bob = await fundBob();
  const bobU = usufruct({ client, signer: bob, graphql: GRAPHQL_TESTNET });

  step('Alice rents A; Bob outbids; the handover window closes → Alice displaced (partial refund)');
  const seatA = await u.escrow(A.id);
  const capA: UsufructCap = await seatA.rent({ tenures: 1, pay: DUMMY(0.5) }).send();
  await (await bobU.escrow(A.id)).rent({ tenures: 1, pay: DUMMY(0.6) }).send();
  const demand = await u.escrow(A.id);
  check('A is in demand (Bob is challenging)', demand.status === 'demand', demand.status);
  await waitForChainTime(client, BigInt((await demand.nextBoundaryAt())!.getTime()));
  await seatA.applyPendingTransitionStates().send();
  check('Bob took over A (Alice displaced)', (await u.escrow(A.id)).status === 'occupied');

  step('settle B — Alice rents and runs the tenure to expiry');
  const seatB = await u.escrow(B.id);
  const capB = await seatB.rent({ tenures: 1, pay: DUMMY(0.5) }).send();
  await waitForChainTime(client, BigInt(capB.receipt!.expiresAt.getTime()));
  await seatB.applyPendingTransitionStates().send();

  // ── ① the renter — usufructCap.statement() ───────────────────────────────
  step('① usufructCap.statement() — Alice’s cap on A: paid → refunded + consumed');
  const stA = await until(() => capA.statement(), (s) => s.status === 'displaced');
  console.log(`   capA: status ${stA.status}  paid ${stA.paid.format()}  consumed ${stA.consumed.format()}  refunded ${stA.refunded.format()}`);
  check('Alice was displaced with a real refund', stA.status === 'displaced' && stA.refunded.mist > 0n && stA.consumed.mist > 0n, `${stA.consumed.format()} + ${stA.refunded.format()}`);
  check('statement reconciles: paid == consumed + refunded', stA.paid.mist === stA.consumed.mist + stA.refunded.mist, `${stA.paid.mist} == ${stA.consumed.mist + stA.refunded.mist}`);

  // ── ② the asset — escrow.tenancies() ─────────────────────────────────────
  step('② escrow.tenancies() — A’s occupancy ledger (Alice → Bob)');
  const tens = await seatA.tenancies();
  for (const t of tens) {
    const span = `${t.startedAt.toISOString().slice(11, 19)}→${t.endedAt ? t.endedAt.toISOString().slice(11, 19) : 'now'}`;
    console.log(`   ${t.usufructuary.slice(0, 10)}…  ${span}  acquired ${t.acquired.format()}  used ${t.usedCredit?.format() ?? '—'}  refund ${t.refund?.format() ?? '—'}`);
  }
  check('two tenancies on A (Alice then Bob)', tens.length === 2, `${tens.length}`);
  check('first is Alice, closed; her refund matches her statement', tens[0]!.capId === capA.id && tens[0]!.endedAt !== null && tens[0]!.refund!.mist === stA.refunded.mist);
  check('second is Bob, ongoing (endedAt null)', tens[1]!.endedAt === null && tens[1]!.usufructuary === bob.toSuiAddress());

  // ── ③ the governor — governanceCap.revenueByEscrow() ─────────────────────
  step('③ governanceCap.revenueByEscrow() — earnings attributed per asset');
  const rev = await until(() => governanceCap.revenueByEscrow(), (r) => r.length >= 2);
  const sumMist = (e: typeof rev) => e.reduce((a, x) => a + x.earnings.reduce((b, c) => b + c.total.mist, 0n), 0n);
  for (const r of rev) console.log(`   ${r.escrowId.slice(0, 10)}…  ${r.earnings.map((c) => `${c.total.format()} ×${c.count}`).join(', ')}`);
  const totals = await earningsInbox.totals();
  console.log(`   earningsInbox.totals(): ${totals.map((t) => t.total.format()).join(', ')}`);
  check('revenue split across both escrows', rev.length === 2);
  check('per-escrow revenue sums to the inbox total', sumMist(rev) === totals.reduce((a, t) => a + t.total.mist, 0n), `${sumMist(rev)} == ${totals.reduce((a, t) => a + t.total.mist, 0n)}`);
  void capB;

  finish();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
