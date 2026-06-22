import { describe, expect, it } from 'vitest';
import type { ClientWithCoreApi } from '@mysten/sui/client';
import { createScalarReadVerb } from '@usufruct-protocol/sdk/highlevel/escrowRead.js';
import type { Reader } from '@usufruct-protocol/sdk/read/reader.js';
import type { CoinInfo } from '@usufruct-protocol/sdk/highlevel/value.js';

// 6-decimal coin — proves the render is coin-aware (not a hard-coded 9).
const USDC: CoinInfo = { type: '0xa::usdc::USDC', decimals: 6, symbol: 'USDC' };

/** A Reader stub returning fixed raw kernel scalars for the views under test. */
function stubReader(over: Partial<Record<keyof Reader, unknown>>): Reader {
  const base: Record<string, () => Promise<unknown>> = {};
  return new Proxy(base, {
    get(_t, prop: string) {
      return (..._a: unknown[]) => Promise.resolve(over[prop as keyof Reader]);
    },
  }) as unknown as Reader;
}

// `t`-param views resolve `When`; a Date never touches the client.
const NO_CLIENT = {} as ClientWithCoreApi;

describe('escrow read verb — scalar auto-render', () => {
  it('renders mist → Price in the escrow coin (exact .mist preserved)', async () => {
    const read = createScalarReadVerb(
      stubReader({ floorPriceMist: 1_500_000n }),
      USDC,
      NO_CLIENT,
    );
    const p = await read.floorPrice(new Date(0));
    expect(p.mist).toBe(1_500_000n); // exact
    expect(p.coin.symbol).toBe('USDC');
    expect(p.format()).toBe('1.50 USDC'); // 6-decimal render
  });

  it('renders ms-timestamp → Date', async () => {
    const read = createScalarReadVerb(stubReader({ tenureExpiryMs: 1_700_000_000_000n }), USDC, NO_CLIENT);
    const d = await read.expiresAt();
    expect(d).toBeInstanceOf(Date);
    expect(d!.getTime()).toBe(1_700_000_000_000);
  });

  it('renders ms-duration / count → number', async () => {
    const read = createScalarReadVerb(
      stubReader({ tenureCeilingMs: 86_400_000n, activeCommittedTenures: 3n }),
      USDC,
      NO_CLIENT,
    );
    expect(await read.tenureCeiling()).toBe(86_400_000);
    expect(await read.activeCommittedTenures()).toBe(3);
  });

  it('passes booleans through and threads the probe cap id', async () => {
    const read = createScalarReadVerb(
      stubReader({ isOccupied: true, usufructCapIsActive: true }),
      USDC,
      NO_CLIENT,
    );
    expect(await read.isOccupied()).toBe(true);
    expect(await read.usufructCapIsActive('0xcap')).toBe(true);
  });

  it('maps a null optional view to null (no Price wrapper)', async () => {
    const read = createScalarReadVerb(
      stubReader({ activeStakeBalanceMist: null, lastRentPriceMist: null }),
      USDC,
      NO_CLIENT,
    );
    expect(await read.activeStake()).toBeNull();
    expect(await read.lastRentPrice()).toBeNull();
  });
});
