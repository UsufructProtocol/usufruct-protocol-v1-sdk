/**
 * PROBE — replay a LONGER market history through the escrow handle.
 *
 * Drives the full lifecycle twice, with an ensemble shape change between:
 *
 *   Idle → Occupied → Demand → Demand → Demand → Demand → Occupied → Descent → Idle
 *     → update_ensemble (creditShape exponential(+4) → logistic) →
 *   Idle → Occupied → Demand → Demand → Demand → Demand → Occupied → Descent → Idle
 *
 * The four Demands are one bid + three supersedes (rent() is polymorphic: rent when
 * idle, bid when occupied, supersede when in demand). `handover: 'fullTenure'` keeps
 * the sitting tenant protected to tenure end, so challengers outbid each other in the
 * Demand window; at the boundary the winner takes over (handover), sits a tenure, then
 * its expiry opens the Dutch auction.
 *
 * Then it renders the whole thing from the event log via the handle methods:
 *   escrow.priceTimeline()  — rent / bid / supersede / handover prices + descent curves
 *   escrow.creditHistory()  — every tenure (incl. handover occupants), each with its
 *                             cycle's credit shape
 *
 * Run from the monorepo root:  npx tsx examples/market-replay/index.ts
 * Long — ~4 min of real tenure/descent waits on testnet.
 */
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { coinTag, usufruct, type Usufruct } from '@usufruct-protocol/sdk';
import { GRAPHQL_TESTNET } from '@usufruct-protocol/sdk/config/network.js';
import type { CreditSegment, CurvePoint } from '@usufruct-protocol/sdk/highlevel/timeline.js';
import type { CurveShape } from '@usufruct-protocol/sdk/read/curve.js';
import {
  check,
  createdId,
  finish,
  loadSigner,
  makeClient,
  rateLimited,
  send,
  step,
  waitForChainTime,
} from '../../scripts/lib.js';

const DUMMY_PKG = '0xa72e830fcb3e688ab3c20ff3cbd0a149cd1b58715709905585e75eb18317a52a';
const DUMMY_COIN_PKG = '0x97fb7c77162e3edf6a44815ec9eb29b69f9a43747dfb1c1019a7fc5501e2ad96';
const DUMMY_COIN_TREASURY = '0xccee2bc2227913f441c7544892cf5d220880cbc0c55be8733b4b6777def976bc';
const DUMMY = coinTag({ type: `${DUMMY_COIN_PKG}::dummy_coin::DUMMY_COIN`, decimals: 9, symbol: 'DUMMY' });

const client = rateLimited(makeClient());
const me = loadSigner();

// ── helpers ──────────────────────────────────────────────────────────────

const shapeLabel = (s: CurveShape): string =>
  s.kind === 'powerLaw'
    ? `powerLaw(${s.alphaNum}/${s.alphaDen})`
    : s.kind === 'exponential'
      ? `exponential(${s.alphaNeg ? '-' : '+'}${s.alphaAbs})`
      : s.kind;

function renderCurve(points: readonly CurvePoint[], width = 34): string {
  const max = points.reduce((m, p) => (p.value.mist > m ? p.value.mist : m), 0n);
  return points
    .map((p) => {
      const len = max === 0n ? 0 : Math.max(0, Math.round((Number(p.value.mist) / Number(max)) * width));
      const off = (p.offsetMs / 1000).toFixed(1).padStart(5);
      return `      t+${off}s  ${p.value.toSui().toFixed(4).padStart(8)}  ${'█'.repeat(len)}`;
    })
    .join('\n');
}

/** Credit curves side by side at shared scale — read the shape change directly. */
function renderHistory(segs: readonly CreditSegment[], width = 18): string {
  const max = segs.reduce((m, s) => s.points.reduce((mm, p) => (p.value.mist > mm ? p.value.mist : mm), m), 0n);
  const bar = (p: CurvePoint): string => {
    const len = max === 0n ? 0 : Math.max(0, Math.round((Number(p.value.mist) / Number(max)) * width));
    return `${p.value.toSui().toFixed(4)} ${('█'.repeat(len) + ' '.repeat(width)).slice(0, width)}`;
  };
  const head = '   offset   ' + segs.map((s, i) => `#${i + 1} ${shapeLabel(s.shape)}`.padEnd(width + 8)).join(' ');
  const n = Math.min(...segs.map((s) => s.points.length));
  const rows = Array.from({ length: n }, (_, i) => {
    const off = (segs[0]!.points[i]!.offsetMs / 1000).toFixed(1).padStart(5);
    return `   t+${off}s  ${segs.map((s) => bar(s.points[i]!)).join(' ')}`;
  });
  return `${head}\n${rows.join('\n')}`;
}

/** A funded challenger: fresh keypair, gas + DUMMY, with its own usufruct handle. */
interface Bidder {
  readonly u: Usufruct;
  readonly addr: string;
}

async function fundBidders(n: number): Promise<Bidder[]> {
  const kps = Array.from({ length: n }, () => Ed25519Keypair.generate());
  const tx = new Transaction();
  for (const kp of kps) {
    tx.transferObjects([tx.splitCoins(tx.gas, [50_000_000n])[0]!], kp.toSuiAddress());
    tx.transferObjects(
      [tx.moveCall({ target: `${DUMMY_COIN_PKG}::dummy_coin::mint`, arguments: [tx.object(DUMMY_COIN_TREASURY), tx.pure.u64(3_000_000_000n)] })],
      kp.toSuiAddress(),
    );
  }
  await send(client, tx, me);
  return kps.map((kp) => ({ u: usufruct({ client, signer: kp }), addr: kp.toSuiAddress() }));
}

async function main() {
  const u = usufruct({ client, signer: me, graphql: GRAPHQL_TESTNET });

  step('setup — list (handover: fullTenure so Demand sustains), fund 8 challengers');
  const mintTx = new Transaction();
  mintTx.transferObjects([mintTx.moveCall({ target: `${DUMMY_PKG}::dummy_asset::mint` })], me.toSuiAddress());
  mintTx.transferObjects(
    [mintTx.moveCall({ target: `${DUMMY_COIN_PKG}::dummy_coin::mint`, arguments: [mintTx.object(DUMMY_COIN_TREASURY), mintTx.pure.u64(3_000_000_000n)] })],
    me.toSuiAddress(),
  );
  const assetId = createdId(await send(client, mintTx, me), '::dummy_asset::DummyAsset');
  const bidders = await fundBidders(8);

  const { escrow, governanceCap } = await u.write
    .integrate({
      asset: assetId,
      coin: DUMMY,
      market: {
        restPrice: DUMMY(0.01), tenure: '36s', multiTenure: false,
        creditShape: { exponential: { alpha: 4 } },
        auctionShape: 'logistic',
        descent: '18s', handover: 'fullTenure',
        escalation: { fixed: DUMMY(0.001) },
        retireCommitment: 'immediate', ensembleCommitment: 'immediate',
      },
    })
    .send();
  const id = escrow.id;
  const seat = await u.nav.escrow(id);

  /** Apply at each boundary until the escrow reaches `target`. */
  async function driveTo(target: string): Promise<void> {
    for (;;) {
      const e = await u.nav.escrow(id);
      if ((await e.read.assetState()).kind === target) return;
      const b = await e.read.nextBoundaryAt();
      if (b) await waitForChainTime(client, BigInt(b.getTime()));
      await seat.write.applyPendingTransitionStates().send();
    }
  }

  /** One full cycle: A rents, four challengers outbid (Demand×4), winner takes over,
   *  sits a tenure, then the auction descends back to idle. */
  async function runCycle(label: string, who: Bidder[]): Promise<void> {
    step(`${label} — rent (A), then Demand×4 (one bid + three supersedes)`);
    // Pre-resolve every seat BEFORE bidding, so the bids land back-to-back inside
    // the sitting tenant's handover window (a re-resolve per bid is too slow).
    const aSeat = await u.nav.escrow(id);
    const seats = await Promise.all(who.map((b) => b.u.nav.escrow(id)));
    await aSeat.write.rent({ tenures: 1, pay: DUMMY(0.5) }).send();
    console.log('   A occupied');
    const bids = [0.6, 0.7, 0.8, 0.9];
    for (let i = 0; i < bids.length; i++) {
      await seats[i]!.write.rent({ tenures: 1, pay: DUMMY(bids[i]!) }).send();
      const es = await (await u.nav.escrow(id)).read.assetState();
      const pending = es.kind === 'demand' ? es.challenger.slice(0, 8) : '';
      console.log(`   ${i === 0 ? 'bid      ' : 'supersede'} ${bids[i]!.toFixed(2)} DUMMY  → status ${es.kind}, pending ${pending}…`);
    }
    step(`${label} — let the handover settle (winner occupies), then expire into descent`);
    await driveTo('descent');
    console.log('   winner took over, its tenure expired → descent');
    await driveTo('idle');
    console.log('   descent bottomed out → idle');
  }

  await runCycle('cycle 1', bidders.slice(0, 4));

  step('governance — flip creditShape exponential(+4) → logistic');
  await governanceCap.write.updateMarket(id, { creditShape: 'logistic' }).send();

  await runCycle('cycle 2', bidders.slice(4, 8));

  // ── replay the whole market from the log ──────────────────────────────
  step('escrow.priceTimeline() — the full chronology from events');
  const timeline = await seat.inspect.priceTimeline({ points: 10 });
  for (const s of timeline) {
    const at = s.at.toISOString().slice(11, 19);
    if (s.kind === 'descent') {
      console.log(`   ${at}  descent   ${s.from.format()} → ${s.to.format()}  (${shapeLabel(s.shape)}, ${s.descentMs / 1000}s):`);
      console.log(renderCurve(s.points));
    } else {
      console.log(`   ${at}  ${s.kind.padEnd(9)} ${s.price.format()}  ${s.by ? s.by.slice(0, 8) + '…' : ''}`);
    }
  }

  step('escrow.creditHistory() — every tenure (initial + handover occupants), per shape');
  const hist = await seat.inspect.creditHistory({ points: 12 });
  console.log(renderHistory(hist) + '\n');
  hist.forEach((s, i) =>
    console.log(`   tenure #${i + 1}: ${shapeLabel(s.shape).padEnd(16)} principal ${s.principal.format()}`),
  );

  const kinds = timeline.map((s) => s.kind);
  const n = (k: string) => kinds.filter((x) => x === k).length;
  check('two Dutch-auction descents (one per cycle)', n('descent') === 2, kinds.join(','));
  check('a sustained Demand chain (bids + supersedes)', n('bid') + n('supersede') >= 6, `${n('bid')} bids, ${n('supersede')} supersedes`);
  check('handover occupants present (more tenures than rents)', hist.length > 2, `${hist.length} tenures from ${n('rent')} rents`);
  check('credit shape changed across the update', hist[0]!.shape.kind !== hist[hist.length - 1]!.shape.kind, hist.map((s) => s.shape.kind).join(' → '));

  finish();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
