import { describe, expect, it, vi } from 'vitest';
import { bcs } from '@mysten/sui/bcs';
import type { ClientWithCoreApi } from '@mysten/sui/client';
import {
  reconstructCreditHistory,
  reconstructPriceTimeline,
} from '@usufruct-protocol/sdk/highlevel/timeline.js';
import { coinInfo } from '@usufruct-protocol/sdk/highlevel/value.js';
import type { HistoryEvent } from '@usufruct-protocol/sdk/highlevel/history.js';

const PKG = '0x2';
const COIN = coinInfo('0x2::sui::SUI');
const CAP = '0x' + 'a1'.repeat(32);
const ADDR = '0x' + '11'.repeat(32);
const u64 = (v: bigint) => bcs.u64().serialize(v).toBytes();
const ev = (kind: string, data: Record<string, unknown>): HistoryEvent => ({ kind, module: 'asset_state', at: null, by: null, data });

function fakeClient(perSim: bigint[][]): { client: ClientWithCoreApi; sim: ReturnType<typeof vi.fn> } {
  let i = 0;
  const sim = vi.fn(async () => ({
    $kind: 'Transaction' as const,
    commandResults: perSim[i++]!.map((v) => ({ returnValues: [{ bcs: u64(v) }] })),
  }));
  return { client: { core: { simulateTransaction: sim } } as unknown as ClientWithCoreApi, sim };
}

/** The curve shape comes from the governing ensemble event, not CycleParamsResolved. */
const registered = (creditShape: string, auctionShape: string, tsMs: string) =>
  ev('PolicyEnsembleRegistered', {
    credit_shape_policy: creditShape, auction_shape_policy: auctionShape, timestamp_ms: tsMs,
  });

describe('reconstructCreditHistory — stitch tenure + shape from the ensemble event', () => {
  it('builds one segment per tenure, shape from the governing ensemble', async () => {
    const events = [
      registered('Logistic', 'Linear', '500'),
      ev('RentStarted', {
        usufruct_cap_id: CAP, usufructuary_address: ADDR,
        price_paid: '1000', ceiling_total_ms: '40000', timestamp_ms: '1000',
      }),
    ];
    // one sim: [shape ctor] + 5 sampled points (points:4 → spanTimes gives 5).
    const { client } = fakeClient([[0n, 0n, 250n, 500n, 750n, 1000n]]);
    const hist = await reconstructCreditHistory(events, client, PKG, COIN, { points: 4 });

    expect(hist).toHaveLength(1);
    expect(hist[0]!.shape).toEqual({ kind: 'logistic' }); // from PolicyEnsembleRegistered, not the cycle
    expect(hist[0]!.principal.mist).toBe(1000n);
    expect(hist[0]!.ceilingMs).toBe(40000);
    expect(hist[0]!.startedAt.getTime()).toBe(1000);
    expect(hist[0]!.points).toHaveLength(5);
    expect(hist[0]!.points.map((p) => p.value.mist)).toEqual([0n, 250n, 500n, 750n, 1000n]);
    expect(hist[0]!.points[2]!.offsetMs).toBe(20000); // half of the 40000 ceiling
  });

  it('a later EnsembleUpdated changes the shape for tenures after it', async () => {
    const events = [
      registered('Exponential', 'Linear', '500'),
      ev('RentStarted', { usufruct_cap_id: CAP, usufructuary_address: ADDR, price_paid: '1000', ceiling_total_ms: '10', timestamp_ms: '1000' }),
      ev('EnsembleUpdated', { credit_shape_policy: 'Logistic', auction_shape_policy: 'Linear', timestamp_ms: '2000' }),
      ev('RentStarted', { usufruct_cap_id: CAP, usufructuary_address: ADDR, price_paid: '2000', ceiling_total_ms: '10', timestamp_ms: '3000' }),
    ];
    const { client } = fakeClient([[0n, 1n, 2n], [0n, 3n, 4n]]); // points:1 → 2 samples each
    const hist = await reconstructCreditHistory(events, client, PKG, COIN, { points: 1 });
    expect(hist.map((h) => h.shape.kind)).toEqual(['exponential', 'logistic']);
  });
});

describe('reconstructPriceTimeline — discrete markers + descent curve', () => {
  it('emits acquisition markers and a descent segment (from TenureExpired)', async () => {
    const events = [
      registered('Linear', 'Logistic', '500'),
      ev('CycleParamsResolved', { floor_mist: '10', descent_ms: '100', timestamp_ms: '500' }),
      ev('RentStarted', { usufruct_cap_id: CAP, usufructuary_address: ADDR, price_paid: '500', timestamp_ms: '1000' }),
      ev('TenureExpired', { usufruct_cap_id: CAP, last_acquisition_price: '500', timestamp_ms: '41000' }),
    ];
    // one sim for the single descent: [shape] + 4 points (points:3 → 4 samples).
    const { client } = fakeClient([[0n, 500n, 300n, 100n, 10n]]);
    const tl = await reconstructPriceTimeline(events, client, PKG, COIN, { points: 3 });

    const rent = tl.find((s) => s.kind === 'rent');
    const descent = tl.find((s) => s.kind === 'descent');
    expect(rent && rent.kind === 'rent' && rent.price.mist).toBe(500n);
    if (!descent || descent.kind !== 'descent') throw new Error('no descent segment');
    expect(descent.from.mist).toBe(500n); // last acquisition price
    expect(descent.to.mist).toBe(10n); //    the cycle floor
    expect(descent.shape).toEqual({ kind: 'logistic' }); // auction shape from the ensemble event
    expect(descent.descentMs).toBe(100);
    expect(descent.points.map((p) => p.value.mist)).toEqual([500n, 300n, 100n, 10n]);
  });

  it('skips the descent curve when the cycle has descent off', async () => {
    const events = [
      registered('Linear', 'Linear', '500'),
      ev('CycleParamsResolved', { floor_mist: '10', descent_ms: '0', timestamp_ms: '500' }),
      ev('RentStarted', { usufruct_cap_id: CAP, usufructuary_address: ADDR, price_paid: '500', timestamp_ms: '1000' }),
      ev('TenureExpired', { usufruct_cap_id: CAP, last_acquisition_price: '500', timestamp_ms: '41000' }),
    ];
    const { client, sim } = fakeClient([]); // no sampling should happen
    const tl = await reconstructPriceTimeline(events, client, PKG, COIN, { points: 3 });
    expect(tl.some((s) => s.kind === 'descent')).toBe(false);
    expect(sim).not.toHaveBeenCalled();
  });
});
