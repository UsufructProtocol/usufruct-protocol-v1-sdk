import { bcs } from '@mysten/sui/bcs';
import type { ClientWithCoreApi } from '@mysten/sui/client';
import { describe, expect, it } from 'vitest';
import { chainNow, resolveWhen } from '../src/highlevel/clock.js';
import { resolveRole } from '../src/highlevel/role.js';

const PKG = '0xpkg';
const CAP = `${PKG}::usufruct_cap::UsufructCap`;
const GOV = `${PKG}::governance_cap::GovernanceCap`;

/** Fake client whose `listOwnedObjects` serves owner→type→ids, with pagination. */
function fakeOwned(owned: Record<string, string[]>, pageSize = 50): ClientWithCoreApi {
  return {
    core: {
      listOwnedObjects: async ({
        type,
        cursor,
      }: {
        type: string;
        cursor: string | null;
      }) => {
        const ids = owned[type] ?? [];
        const start = cursor ? Number(cursor) : 0;
        const slice = ids.slice(start, start + pageSize);
        const next = start + pageSize;
        const hasNextPage = next < ids.length;
        return {
          objects: slice.map((objectId) => ({ objectId })),
          hasNextPage,
          cursor: hasNextPage ? String(next) : null,
        };
      },
    },
  } as unknown as ClientWithCoreApi;
}

const INBOX = `${PKG}::earnings_inbox::EarningsInbox`;

describe('highlevel/role — resolveRole', () => {
  it('no owner (read-only) → no role', async () => {
    const r = await resolveRole(fakeOwned({}), PKG, null, '0xcap', '0xgov', '0xinbox');
    expect(r).toEqual({ capId: null, governs: false, holdsEarnings: false });
  });

  it('no objects to look up → no role', async () => {
    const r = await resolveRole(fakeOwned({}), PKG, '0xbob', null, null, null);
    expect(r).toEqual({ capId: null, governs: false, holdsEarnings: false });
  });

  it('signer holds the active cap → capId set, canBorrow', async () => {
    const client = fakeOwned({ [CAP]: ['0xother', '0xcap'] });
    const r = await resolveRole(client, PKG, '0xbob', '0xcap', null, null);
    expect(r.capId).toBe('0xcap');
    expect(r.governs).toBe(false);
  });

  it('signer does NOT hold the active cap → capId null', async () => {
    const client = fakeOwned({ [CAP]: ['0xother'] });
    const r = await resolveRole(client, PKG, '0xbob', '0xcap', null, null);
    expect(r.capId).toBeNull();
  });

  it('signer holds the governance cap → governs', async () => {
    const client = fakeOwned({ [GOV]: ['0xgov'] });
    const r = await resolveRole(client, PKG, '0xalice', null, '0xgov', null);
    expect(r.governs).toBe(true);
    expect(r.capId).toBeNull();
  });

  it('signer holds the earnings inbox → holdsEarnings (separable from governance)', async () => {
    // holds the inbox but NOT the gov cap — the object-centric split in action.
    const client = fakeOwned({ [INBOX]: ['0xinbox'] });
    const r = await resolveRole(client, PKG, '0xtreasury', null, '0xgov', '0xinbox');
    expect(r.holdsEarnings).toBe(true);
    expect(r.governs).toBe(false);
  });

  it('paginates owned objects (cap on a later page)', async () => {
    const many = Array.from({ length: 120 }, (_, i) => `0x${i}`);
    many.push('0xcap');
    const client = fakeOwned({ [CAP]: many });
    const r = await resolveRole(client, PKG, '0xbob', '0xcap', null, null);
    expect(r.capId).toBe('0xcap');
  });
});

describe('highlevel/clock — resolveWhen / chainNow', () => {
  const CLOCK = bcs.struct('Clock', { id: bcs.Address, timestamp_ms: bcs.u64() });
  function fakeClock(tsMs: bigint): ClientWithCoreApi {
    const content = CLOCK.serialize({ id: '0x6', timestamp_ms: tsMs.toString() }).toBytes();
    return {
      core: { getObject: async () => ({ object: { content } }) },
    } as unknown as ClientWithCoreApi;
  }

  it('reads chain time from the 0x6 Clock', async () => {
    expect(await chainNow(fakeClock(1_700_000_000_000n))).toBe(1_700_000_000_000n);
  });

  it('defaults / "now" resolve to chain time', async () => {
    const c = fakeClock(42n);
    expect(await resolveWhen(c)).toBe(42n);
    expect(await resolveWhen(c, 'now')).toBe(42n);
  });

  it('an explicit Date or number does not hit the chain', async () => {
    expect(await resolveWhen(fakeClock(0n), new Date(1_234_567))).toBe(1_234_567n);
    expect(await resolveWhen(fakeClock(0n), 9_999)).toBe(9_999n);
  });
});
