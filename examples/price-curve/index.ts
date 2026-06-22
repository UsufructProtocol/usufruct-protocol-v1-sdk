/**
 * PROBE — price curves: rendering the protocol's time-varying values.
 *
 * A frontend/analytics view wants to plot two curves with non-trivial shapes:
 *   ① credit accrual over the tenure — `accruedCreditMist(t)`, creditShape exponential(+4)
 *   ② the Dutch-auction floor in descent — `floorPriceMist(t)`, auctionShape logistic
 * To draw an N-point curve you sample the view at N timestamps.
 *
 * Collision (measured here): the curve-math views are Pattern A — ONE read per `t`.
 * `reader.batch(names, opts)` batches many *views* at one `t`; it cannot sample one
 * view at many `t`. So an N-point curve = N `simulateTransaction` round-trips. This
 * script counts them.
 *
 * Unlike the keeper→next_boundary case (which needed a new on-chain view), this is
 * likely fixable SDK-side: a PTB can carry N floor_price_mist(t_i) calls in ONE
 * simulateTransaction. See the README for the proposed `escrow.priceCurve(...)`.
 *
 * Run from the monorepo root:  npx tsx examples/price-curve/index.ts
 */
import type { ClientWithCoreApi } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { coinTag, createReader, id as toId, usufruct } from '@usufruct-protocol/sdk';
import { TESTNET } from '@usufruct-protocol/sdk/config/network.js';
import { chainNowMs, check, createdId, finish, loadSigner, makeClient, rateLimited, send, step, waitForChainTime } from '../../scripts/lib.js';

const DUMMY_PKG = '0xa72e830fcb3e688ab3c20ff3cbd0a149cd1b58715709905585e75eb18317a52a';
const DUMMY_COIN_PKG = '0x97fb7c77162e3edf6a44815ec9eb29b69f9a43747dfb1c1019a7fc5501e2ad96';
const DUMMY_COIN_TREASURY = '0xccee2bc2227913f441c7544892cf5d220880cbc0c55be8733b4b6777def976bc';
const DUMMY = coinTag({ type: `${DUMMY_COIN_PKG}::dummy_coin::DUMMY_COIN`, decimals: 9, symbol: 'DUMMY' });

const client = rateLimited(makeClient());
const me = loadSigner();

/** Wrap a client so every `core.simulateTransaction` increments a counter — the
 *  read round-trips, the thing this probe measures. */
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

const fmt = (mist: bigint) => `${(Number(mist) / 1e9).toFixed(4)} DUMMY`;

/** A horizontal ASCII bar chart of the curve, bars scaled to the max value. */
function asciiChart(points: Array<{ offsetS: number; mist: bigint }>, width = 44): string {
  const max = points.reduce((m, p) => (p.mist > m ? p.mist : m), 0n);
  const rows = points.map((p) => {
    const len = max === 0n ? 0 : Math.max(1, Math.round((Number(p.mist) / Number(max)) * width));
    return `   t+${String(p.offsetS).padStart(2)}s  ${(Number(p.mist) / 1e9).toFixed(4)}  ${'█'.repeat(len)}`;
  });
  return rows.join('\n');
}

type Point = { offsetS: number; mist: bigint };

/** Sample a Pattern-A view (one read per `t`) across a window — one round-trip each. */
async function sampleCurve(
  read: (t: bigint) => Promise<unknown>,
  now: bigint,
  stepMs: bigint,
  points: number,
): Promise<Point[]> {
  const out: Point[] = [];
  for (let i = 0; i < points; i++) {
    const off = stepMs * BigInt(i);
    out.push({ offsetS: Number(off) / 1000, mist: (await read(now + off)) as unknown as bigint });
  }
  return out;
}

async function main() {
  step('setup — list with non-trivial curves: credit exponential(+4), descent logistic');
  const tx = new Transaction();
  tx.transferObjects([tx.moveCall({ target: `${DUMMY_PKG}::dummy_asset::mint` })], me.toSuiAddress());
  // free-mint DUMMY for the overpay, so the example is self-contained / re-runnable.
  tx.transferObjects(
    [tx.moveCall({ target: `${DUMMY_COIN_PKG}::dummy_coin::mint`, arguments: [tx.object(DUMMY_COIN_TREASURY), tx.pure.u64(1_000_000_000n)] })],
    me.toSuiAddress(),
  );
  const assetId = createdId(await send(client, tx, me), '::dummy_asset::DummyAsset');

  const u = usufruct({ client, signer: me });
  const { escrow } = await u.write
    .integrate({
      asset: assetId,
      coin: DUMMY,
      market: {
        restPrice: DUMMY(0.01), tenure: '20s', multiTenure: false,
        creditShape: { exponential: { alpha: 4 } }, // credit accrues on a steep exponential
        auctionShape: 'logistic', //                   the Dutch auction descends on an S-curve
        descent: '60s', handover: 'off',
        escalation: { fixed: DUMMY(0.001) },
        retireCommitment: 'immediate', ensembleCommitment: 'immediate',
      },
    })
    .send();
  const seat = await u.nav.escrow(escrow.id);
  // Overpay (0.5 ≫ the 0.01 floor) so the auction has a high ceiling to descend FROM.
  const rentCap = await seat.write.rent({ tenures: 1, pay: DUMMY(0.5) }).send();
  console.log('   rented (overpaid → high ceiling, big credit principal)');

  const { client: counting, count } = countingSims(makeClient());
  const reader = createReader(counting, {
    packageId: TESTNET.packageId,
    escrowId: toId<'Escrow'>(escrow.id),
    typeArguments: [escrow.assetType, escrow.coinType],
  });

  step('curve ① — credit accrual over the tenure  (creditShape: exponential +4)');
  const tOcc = await chainNowMs(client);
  const credit = await sampleCurve((t) => reader.accruedCreditMist(t as never), tOcc, 2_000n, 11); // 0…20s
  console.log('   accruedCreditMist(t) — DUMMY:\n');
  console.log(asciiChart(credit));

  step('settle into descent, then curve ② — the Dutch auction  (auctionShape: logistic)');
  await waitForChainTime(client, BigInt(rentCap.receipt!.expiresAt.getTime()));
  await seat.write.applyPendingTransitionStates().send();
  const e = await u.nav.escrow(escrow.id);
  const eState = await e.read.assetState();
  check('escrow is in descent', eState.kind === 'descent', eState.kind);
  const tDesc = await chainNowMs(client);
  const floor = await sampleCurve((t) => reader.floorPriceMist(t as never), tDesc, 5_000n, 13); // 0…60s
  console.log('   floorPriceMist(t) — DUMMY:\n');
  console.log(asciiChart(floor));
  console.log(`\n   …down to the rest price ${fmt(floor[floor.length - 1]!.mist)}`);

  const roundTrips = count();
  const points = credit.length + floor.length;
  const creditRises = credit.every((p, i) => i === 0 || p.mist >= credit[i - 1]!.mist);
  const floorFalls = floor.every((p, i) => i === 0 || p.mist <= floor[i - 1]!.mist);
  console.log(`\n   round-trips (simulateTransaction): ${roundTrips} for ${points} sampled points`);
  check('credit curve rises (exponential accrual)', creditRises);
  check('floor curve descends (logistic auction)', floorFalls);
  check('cost is O(N): one round-trip PER sampled point', roundTrips === points, `${roundTrips} === ${points}`);

  finish();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
