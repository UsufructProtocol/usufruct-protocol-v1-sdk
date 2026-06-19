/**
 * PROBE — historical price/credit timeline, reconstructed drift-zero from events.
 *
 * The price-curve probe drew LIVE curves (sampling a view at the current state).
 * This one asks the harder question: can a consumer redraw an escrow's PAST
 * curves — every tenure's credit accrual, every Dutch-auction descent — reading
 * ONLY the event log, exactly as the chain computed them, even across an ensemble
 * update that changes the curve shape?
 *
 * It needed a protocol change (this deploy): the parameterized views
 *   escrow::{descent_floor_at, used_credit_at}
 * fed by event params + the per-cycle shape now carried in CycleParamsResolved.
 * The SDK builds the shape on-chain via ensemble::new_* and samples the view over
 * N points in ONE simulateTransaction (read/curve.ts).
 *
 * What this demonstrates:
 *   ① reconstruct a tenure's credit curve from events  ≡  the live view  (drift-zero)
 *   ② reconstruct a descent's floor curve from events   ≡  the live view  (drift-zero)
 *   ③ flip creditShape exponential(+4) → logistic mid-life; cycle 2 reconstructs
 *      with the NEW shape, from the same log — the historical curve "remembers".
 *   ④ N points cost ⌈N/39⌉ simulations (batched), not N (the price-curve finding).
 *
 * Run from the monorepo root:  npx tsx examples/price-timeline/index.ts
 */
import type { ClientWithCoreApi } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { coinTag, createReader, id as toId, usufruct } from '@usufruct-protocol/sdk';
import { GRAPHQL_TESTNET, TESTNET } from '@usufruct-protocol/sdk/config/network.js';
import {
  sampleCreditCurve,
  sampleDescentCurve,
  type CurveShape,
} from '@usufruct-protocol/sdk/read/curve.js';
import {
  chainNowMs,
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

const client = rateLimited(makeClient());
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

/** The MoveEnum-decoded CurveShapePolicy from an event → read/curve.ts CurveShape. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toCurveShape(s: any): CurveShape {
  switch (s.$kind) {
    case 'Linear':
      return { kind: 'linear' };
    case 'Smoothstep':
      return { kind: 'smoothstep' };
    case 'Logistic':
      return { kind: 'logistic' };
    case 'PowerLaw':
      return { kind: 'powerLaw', alphaNum: Number(s.PowerLaw.alpha_num), alphaDen: Number(s.PowerLaw.alpha_den) };
    case 'Exponential':
      return {
        kind: 'exponential',
        alphaAbs: Number(s.Exponential.alpha_abs),
        alphaNeg: Boolean(s.Exponential.alpha_neg),
      };
    default:
      throw new Error(`unknown curve shape ${JSON.stringify(s)}`);
  }
}

const u64 = (v: unknown) => BigInt(v as string | number | bigint);

/** N+1 sample times spanning [start, start+span]. */
function spanTimes(start: bigint, span: bigint, points: number): bigint[] {
  const out: bigint[] = [];
  for (let i = 0; i <= points; i++) out.push(start + (span * BigInt(i)) / BigInt(points));
  return out;
}

const D = (mist: bigint) => Number(mist) / 1e9;

/** Horizontal ASCII bars scaled to the curve's max. */
function asciiChart(start: bigint, ts: bigint[], vals: bigint[], width = 40): string {
  const max = vals.reduce((m, v) => (v > m ? v : m), 0n);
  return ts
    .map((t, i) => {
      const v = vals[i]!;
      const len = max === 0n ? 0 : Math.max(0, Math.round((Number(v) / Number(max)) * width));
      const off = Number(t - start) / 1000;
      return `   t+${off.toFixed(1).padStart(5)}s  ${D(v).toFixed(4).padStart(8)}  ${'█'.repeat(len)}`;
    })
    .join('\n');
}

/** reconstructed ≡ live, bit for bit, at every sampled point. */
function assertSame(label: string, recon: bigint[], live: bigint[]): void {
  const same = recon.length === live.length && recon.every((v, i) => v === live[i]);
  const firstDiff = recon.findIndex((v, i) => v !== live[i]);
  check(
    `${label}: reconstructed-from-events ≡ live view (drift-zero)`,
    same,
    same ? `${recon.length} points identical` : `point ${firstDiff}: ${recon[firstDiff]} ≠ ${live[firstDiff]}`,
  );
}

// ── main ─────────────────────────────────────────────────────────────────

async function main() {
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
  const assetId = createdId(await send(client, tx, me), '::dummy_asset::DummyAsset');

  const u = usufruct({ client, signer: me, graphql: GRAPHQL_TESTNET });
  const { escrow, governanceCap } = await u
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

  const seat = await u.escrow(escrow.id);
  const { client: rc, count: reconSims } = countingSims(makeClient());
  const { client: lc, count: liveSims } = countingSims(makeClient());
  const reader = createReader(lc, {
    packageId: PKG,
    escrowId: toId<'Escrow'>(escrow.id),
    typeArguments: [escrow.assetType, escrow.coinType],
  });

  // ── Cycle 1 — exponential credit ──────────────────────────────────────
  step('cycle 1 — rent (overpay → big principal), reconstruct the credit curve from events');
  await seat.rent({ tenures: 1, pay: DUMMY(0.5) }).send();

  let history = await seat.history();
  const rent1 = history.find((e) => e.kind === 'RentStarted')!;
  const cpr1 = governingCpr(history, u64(rent1.data.timestamp_ms));
  const cParams = {
    stakeMist: u64(rent1.data.price_paid),
    phaseStartMs: u64(rent1.data.timestamp_ms),
    ceilingMs: u64(rent1.data.ceiling_total_ms),
    shape: toCurveShape(cpr1.data.credit_shape),
  };
  check('cycle 1 credit shape (from event) is exponential(+4)', cParams.shape.kind === 'exponential', JSON.stringify(cParams.shape));

  const cTs = spanTimes(cParams.phaseStartMs, cParams.ceilingMs, 10);
  const cRecon = await sampleCreditCurve(rc, PKG, cParams, cTs);
  const cLive: bigint[] = [];
  for (const t of cTs) cLive.push(u64(await reader.accruedCreditMist(t as never)));
  console.log('   credit accrual — reconstructed from events (creditShape exponential +4):\n');
  console.log(asciiChart(cParams.phaseStartMs, cTs, cRecon));
  assertSame('credit (exp)', cRecon, cLive);

  step('cycle 1 — settle into descent, reconstruct the Dutch-auction floor from events');
  await waitForChainTime(client, cParams.phaseStartMs + cParams.ceilingMs);
  await seat.applyPendingTransitionStates().send();
  const inDescent = await u.escrow(escrow.id);
  check('escrow is in descent', inDescent.status === 'descent', inDescent.status);

  history = await seat.history();
  const tenureExp1 = history.find((e) => e.kind === 'TenureExpired')!;
  const dParams = {
    lastAcqMist: u64(tenureExp1.data.last_acquisition_price),
    phaseStartMs: u64(tenureExp1.data.timestamp_ms),
    floorMist: u64(cpr1.data.floor_mist),
    descentMs: u64(cpr1.data.descent_ms),
    shape: toCurveShape(cpr1.data.auction_shape),
  };
  const dTs = spanTimes(dParams.phaseStartMs, dParams.descentMs, 12);
  const dRecon = await sampleDescentCurve(rc, PKG, dParams, dTs);
  const dLive: bigint[] = [];
  for (const t of dTs) dLive.push(u64(await reader.floorPriceMist(t as never)));
  console.log('   descent floor — reconstructed from events (auctionShape logistic):\n');
  console.log(asciiChart(dParams.phaseStartMs, dTs, dRecon));
  assertSame('descent (logistic)', dRecon, dLive);

  // ── flip the curve shape mid-life ─────────────────────────────────────
  step('governance — flip creditShape exponential(+4) → logistic, then start cycle 2');
  await waitForChainTime(client, dParams.phaseStartMs + dParams.descentMs);
  await seat.applyPendingTransitionStates().send();
  await governanceCap.updateMarket(escrow.id, { creditShape: 'logistic' }).send();

  // ── Cycle 2 — logistic credit, from the SAME log ──────────────────────
  step('cycle 2 — rent again, reconstruct the credit curve: now logistic, from the same event log');
  await seat.rent({ tenures: 1, pay: DUMMY(0.5) }).send();
  history = await seat.history();
  const rent2 = [...history].reverse().find((e) => e.kind === 'RentStarted')!;
  const cpr2 = governingCpr(history, u64(rent2.data.timestamp_ms));
  const c2Params = {
    stakeMist: u64(rent2.data.price_paid),
    phaseStartMs: u64(rent2.data.timestamp_ms),
    ceilingMs: u64(rent2.data.ceiling_total_ms),
    shape: toCurveShape(cpr2.data.credit_shape),
  };
  check('cycle 2 credit shape (from event) is logistic', c2Params.shape.kind === 'logistic', JSON.stringify(c2Params.shape));

  const c2Ts = spanTimes(c2Params.phaseStartMs, c2Params.ceilingMs, 10);
  const c2Recon = await sampleCreditCurve(rc, PKG, c2Params, c2Ts);
  const c2Live: bigint[] = [];
  for (const t of c2Ts) c2Live.push(u64(await reader.accruedCreditMist(t as never)));
  console.log('   credit accrual — reconstructed from events (creditShape logistic):\n');
  console.log(asciiChart(c2Params.phaseStartMs, c2Ts, c2Recon));
  assertSame('credit (logistic)', c2Recon, c2Live);

  // ── the point: same log, two shapes ───────────────────────────────────
  step('the historical curve remembers its cycle');
  console.log('   cycle 1 credit @ half-tenure (exponential): ' + D(cRecon[5]!).toFixed(4) + ' DUMMY');
  console.log('   cycle 2 credit @ half-tenure (logistic):    ' + D(c2Recon[5]!).toFixed(4) + ' DUMMY');
  check(
    'same escrow, two cycles, two shapes — distinguishable at mid-tenure',
    cRecon[5] !== c2Recon[5],
    `${cRecon[5]} vs ${c2Recon[5]}`,
  );

  const points = cTs.length + dTs.length + c2Ts.length;
  console.log(
    `\n   round-trips — reconstruction: ${reconSims()} sims for ${points} points  |  live (Pattern A): ${liveSims()} sims`,
  );
  check('reconstruction batches: ⌈N/39⌉ sims ≪ N', reconSims() < points, `${reconSims()} < ${points}`);

  finish();
}

/** Latest CycleParamsResolved with timestamp ≤ atMs — the params in force then. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function governingCpr(history: Array<{ kind: string; data: any }>, atMs: bigint) {
  let best: { kind: string; data: any } | undefined;
  for (const e of history) {
    if (e.kind !== 'CycleParamsResolved') continue;
    const ts = u64(e.data.timestamp_ms);
    if (ts <= atMs && (best === undefined || ts >= u64(best.data.timestamp_ms))) best = e;
  }
  if (!best) throw new Error(`no CycleParamsResolved governing t=${atMs}`);
  return best;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
