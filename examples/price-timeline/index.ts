/**
 * PROBE — historical price/credit timeline, reconstructed drift-zero from events.
 *
 * The price-curve probe drew LIVE curves (sampling a view at the current state).
 * This one asks the harder question: can a consumer redraw an escrow's PAST
 * curves — each tenure's credit accrual, each Dutch-auction descent — reading
 * ONLY the event log, exactly as the chain computed them, even across an ensemble
 * update that changes the curve shape?
 *
 * It needed a protocol change (this deploy): the parameterized views
 *   escrow::{descent_floor_at, used_credit_at, ascending_floor_with}
 * fed by event params + the per-cycle shape now carried in CycleParamsResolved.
 * The SDK promotes the reconstruction to four `escrow` handle methods —
 *   escrow.creditHistory() / priceTimeline() / creditCurve() / descentCurve()
 * each building the shape on-chain and sampling the view over N points in ONE
 * simulateTransaction (read/curve.ts).
 *
 * This script DRIVES a small market and RENDERS those methods in your terminal,
 * asserting every reconstructed point equals the live view (drift-zero).
 *
 * Run from the monorepo root:  npx tsx examples/price-timeline/index.ts
 */
import type { ClientWithCoreApi } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { coinTag, createReader, id as toId, usufruct } from '@usufruct-protocol/sdk';
import { GRAPHQL_TESTNET, TESTNET } from '@usufruct-protocol/sdk/config/network.js';
import type { CurvePoint } from '@usufruct-protocol/sdk/highlevel/timeline.js';
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
const PKG = TESTNET.packageId;

const me = loadSigner();

// ── helpers ──────────────────────────────────────────────────────────────

/** Wrap a client so every core.simulateTransaction increments a counter. */
function countingSims(base: ClientWithCoreApi): { client: ClientWithCoreApi; count: () => number } {
  let n = 0;
  const core = new Proxy(base.core as object, {
    get(t, p) {
      const v = (t as Record<string, unknown>)[p as string];
      if (p === 'simulateTransaction' && typeof v === 'function') {
        return (...a: unknown[]) => {
          n += 1;
          return (v as (...x: unknown[]) => unknown).apply(t, a);
        };
      }
      return typeof v === 'function' ? (v as (...x: unknown[]) => unknown).bind(t) : v;
    },
  });
  const wrapped = new Proxy(base as object, {
    get(t, p) {
      if (p === 'core') return core;
      const v = (t as Record<string, unknown>)[p as string];
      return typeof v === 'function' ? (v as (...x: unknown[]) => unknown).bind(t) : v;
    },
  });
  return { client: wrapped as ClientWithCoreApi, count: () => n };
}

const shapeLabel = (s: CurveShape): string =>
  s.kind === 'powerLaw'
    ? `powerLaw(${s.alphaNum}/${s.alphaDen})`
    : s.kind === 'exponential'
      ? `exponential(${s.alphaNeg ? '-' : '+'}${s.alphaAbs})`
      : s.kind;

/** Horizontal ASCII bars scaled to the curve's max. */
function renderCurve(points: readonly CurvePoint[], width = 40): string {
  const max = points.reduce((m, p) => (p.value.mist > m ? p.value.mist : m), 0n);
  return points
    .map((p) => {
      const len = max === 0n ? 0 : Math.max(0, Math.round((Number(p.value.mist) / Number(max)) * width));
      const off = (p.offsetMs / 1000).toFixed(1).padStart(5);
      return `   t+${off}s  ${p.value.toSui().toFixed(4).padStart(8)}  ${'█'.repeat(len)}`;
    })
    .join('\n');
}

/** reconstructed-from-events ≡ live view, bit for bit, at every sampled point. */
async function assertDriftZero(
  label: string,
  points: readonly CurvePoint[],
  live: (t: bigint) => Promise<bigint>,
): Promise<void> {
  let firstDiff = -1;
  for (let i = 0; i < points.length; i++) {
    const l = await live(BigInt(points[i]!.atMs));
    if (l !== points[i]!.value.mist && firstDiff < 0) firstDiff = i;
  }
  check(
    `${label}: reconstructed-from-events ≡ live view (drift-zero)`,
    firstDiff < 0,
    firstDiff < 0 ? `${points.length} points identical` : `differ at point ${firstDiff}`,
  );
}

// ── main ─────────────────────────────────────────────────────────────────

async function main() {
  const writer = rateLimited(makeClient());
  const { client: counting, count } = countingSims(makeClient());

  step('setup — list: credit exponential(+4), descent logistic, 20s tenure, 30s descent');
  const tx = new Transaction();
  tx.transferObjects([tx.moveCall({ target: `${DUMMY_PKG}::dummy_asset::mint` })], me.toSuiAddress());
  tx.transferObjects(
    [
      tx.moveCall({
        target: `${DUMMY_COIN_PKG}::dummy_coin::mint`,
        arguments: [tx.object(DUMMY_COIN_TREASURY), tx.pure.u64(2_000_000_000n)],
      }),
    ],
    me.toSuiAddress(),
  );
  const assetId = createdId(await send(writer, tx, me), '::dummy_asset::DummyAsset');

  // The usufruct handle reads through the counting client (so reconstruction sims
  // are measured); writes go through `writer`. The live oracle uses a third client.
  const u = usufruct({ client: counting, signer: me, graphql: GRAPHQL_TESTNET });
  const uWrite = usufruct({ client: writer, signer: me, graphql: GRAPHQL_TESTNET });
  const { escrow, governanceCap } = await uWrite
    .integrate({
      asset: assetId,
      coin: DUMMY,
      market: {
        restPrice: DUMMY(0.01), tenure: '20s', multiTenure: false,
        creditShape: { exponential: { alpha: 4 } },
        auctionShape: 'logistic',
        descent: '30s', handover: 'off',
        escalation: { fixed: DUMMY(0.001) },
        retireCommitment: 'immediate', ensembleCommitment: 'immediate',
      },
    })
    .send();

  const seat = await u.escrow(escrow.id); // reads via counting client
  const writeSeat = await uWrite.escrow(escrow.id);
  const oracle = createReader(makeClient(), {
    packageId: PKG,
    escrowId: toId<'Escrow'>(escrow.id),
    typeArguments: [escrow.assetType, escrow.coinType],
  });

  // ── Cycle 1 — exponential credit ──────────────────────────────────────
  step('cycle 1 — rent (overpay → big principal); escrow.creditCurve() (creditShape exponential +4)');
  await writeSeat.rent({ tenures: 1, pay: DUMMY(0.5) }).send();

  const c1 = (await seat.creditCurve())!;
  console.log(`   credit accrual — shape ${shapeLabel(c1.shape)}, principal ${c1.principal.format()}:\n`);
  console.log(renderCurve(c1.points));
  await assertDriftZero('credit (exp)', c1.points, (t) => oracle.accruedCreditMist(t as never) as Promise<bigint>);

  step('cycle 1 — settle into descent; escrow.descentCurve() (auctionShape logistic)');
  await waitForChainTime(writer, BigInt(c1.startedAt.getTime()) + BigInt(c1.ceilingMs));
  await writeSeat.applyPendingTransitionStates().send();
  check('escrow is in descent', (await uWrite.escrow(escrow.id)).status === 'descent');

  const d1 = (await seat.descentCurve())!;
  console.log(`   descent floor — shape ${shapeLabel(d1.shape)}, ${d1.from.format()} → ${d1.to.format()}:\n`);
  console.log(renderCurve(d1.points));
  await assertDriftZero('descent (logistic)', d1.points, (t) => oracle.floorPriceMist(t as never) as Promise<bigint>);

  // ── flip the curve shape mid-life ─────────────────────────────────────
  step('governance — flip creditShape exponential(+4) → logistic, then start cycle 2');
  await waitForChainTime(writer, BigInt(d1.startedAt.getTime()) + BigInt(d1.descentMs));
  await writeSeat.applyPendingTransitionStates().send();
  await governanceCap.updateMarket(escrow.id, { creditShape: 'logistic' }).send();

  // ── Cycle 2 — logistic credit, from the SAME log ──────────────────────
  step('cycle 2 — rent again; escrow.creditCurve() now reads logistic, from the same log');
  await writeSeat.rent({ tenures: 1, pay: DUMMY(0.5) }).send();
  const c2 = (await seat.creditCurve())!;
  console.log(`   credit accrual — shape ${shapeLabel(c2.shape)}, principal ${c2.principal.format()}:\n`);
  console.log(renderCurve(c2.points));
  await assertDriftZero('credit (logistic)', c2.points, (t) => oracle.accruedCreditMist(t as never) as Promise<bigint>);

  // ── the whole picture, via the handle ─────────────────────────────────
  step('escrow.creditHistory() — every tenure, each with its cycle’s shape');
  const before = count();
  const hist = await seat.creditHistory({ points: 10 });
  const histSims = count() - before;
  hist.forEach((seg, i) =>
    console.log(`   tenure ${i + 1}: ${shapeLabel(seg.shape).padEnd(16)} principal ${seg.principal.format()}  @half ${seg.points[5]!.value.format()}`),
  );
  check('credit history spans two cycles with two shapes', hist.length === 2 && hist[0]!.shape.kind !== hist[1]!.shape.kind, hist.map((s) => s.shape.kind).join(' → '));

  step('escrow.priceTimeline() — discrete acquisitions + descent curves, one chronology');
  const timeline = await seat.priceTimeline({ points: 10 });
  for (const s of timeline) {
    if (s.kind === 'descent') {
      console.log(`   ${s.at.toISOString().slice(11, 19)}  descent   ${s.from.format()} → ${s.to.format()}  (${shapeLabel(s.shape)}, ${s.descentMs / 1000}s)`);
    } else {
      console.log(`   ${s.at.toISOString().slice(11, 19)}  ${s.kind.padEnd(9)} ${s.price.format()}`);
    }
  }
  check('timeline carries a descent curve segment', timeline.some((s) => s.kind === 'descent'));

  const pts = c1.points.length + d1.points.length + c2.points.length + hist.reduce((n, s) => n + s.points.length, 0);
  console.log(`\n   creditHistory() reconstructed ${hist.length} tenures (${histSims} simulateTransaction for ${hist.reduce((n, s) => n + s.points.length, 0)} points)`);
  check('reconstruction batches: ⌈N/39⌉ sims ≪ N points', histSims < pts);

  finish();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
