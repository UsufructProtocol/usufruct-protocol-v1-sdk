import { bcs } from '@mysten/sui/bcs';
import type { ClientWithCoreApi } from '@mysten/sui/client';
import { describe, expect, it } from 'vitest';
import { chainNow, resolveWhen } from '@usufruct-protocol/sdk/highlevel/clock.js';
import { ownedIds } from '@usufruct-protocol/sdk/highlevel/role.js';

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

describe('highlevel/role — ownedIds (the owned-object lookup discovery composes over)', () => {
  it('collects the ids an owner holds of a type', async () => {
    const ids = await ownedIds(fakeOwned({ [CAP]: ['0xother', '0xcap'] }), '0xbob', CAP);
    expect(ids.has('0xcap')).toBe(true);
    expect(ids.has('0xother')).toBe(true);
    expect(ids.size).toBe(2);
  });

  it('empty when the owner holds nothing of the type', async () => {
    const ids = await ownedIds(fakeOwned({ [GOV]: ['0xgov'] }), '0xbob', CAP);
    expect(ids.size).toBe(0);
  });

  it('keeps types separate (gov cap vs earnings inbox — the object-centric split)', async () => {
    const client = fakeOwned({ [GOV]: ['0xgov'], [INBOX]: ['0xinbox'] });
    expect((await ownedIds(client, '0xt', GOV)).has('0xgov')).toBe(true);
    expect((await ownedIds(client, '0xt', GOV)).has('0xinbox')).toBe(false);
    expect((await ownedIds(client, '0xt', INBOX)).has('0xinbox')).toBe(true);
  });

  it('paginates (an id on a later page is still found)', async () => {
    const many = Array.from({ length: 120 }, (_, i) => `0x${i}`);
    many.push('0xcap');
    const ids = await ownedIds(fakeOwned({ [CAP]: many }), '0xbob', CAP);
    expect(ids.has('0xcap')).toBe(true);
    expect(ids.size).toBe(121);
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
