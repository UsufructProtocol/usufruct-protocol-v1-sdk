/**
 * Offline Source IO: subscribe (poll + dedupe by version, abortable) and
 * query (owned UsufructCap → escrow, deduped, paginated), against a fake
 * core client serving codegen-encoded bytes.
 */
import type { ClientWithCoreApi } from '@mysten/sui/client';
import { describe, expect, it } from 'vitest';
import { Escrow } from '@usufruct-protocol/sdk/codegen/usufruct/escrow.js';
import { UsufructCap } from '@usufruct-protocol/sdk/codegen/usufruct/usufruct_cap.js';
import { id } from '@usufruct-protocol/sdk/primitives/brand.js';
import { chainSource } from '@usufruct-protocol/sdk/primitives/source.js';
import { uidAssetSchema } from '@usufruct-protocol/sdk/primitives/state.js';
import { ASSET_ID, defaultCore, defaultCycle } from './synthetic.js';

const PKG = '0x' + '0a'.repeat(32);
const ESCROW_TYPE = `${PKG}::escrow::Escrow<0xa::dummy::DummyAsset, 0x2::sui::SUI>`;

function escrowBytes(): Uint8Array {
  return Escrow(uidAssetSchema)
    .serialize({
      id: '0x' + 'ab'.repeat(32),
      core: defaultCore,
      state: { Waiting: { Idle: { asset: { asset: { id: ASSET_ID } }, cycle: defaultCycle } } },
    })
    .toBytes();
}

function capBytes(capId: string, escrowId: string): Uint8Array {
  return UsufructCap.serialize({ id: capId, escrow_identity: { id: escrowId } }).toBytes();
}

const obj = (objectId: string, version: string) => ({
  objectId,
  version,
  digest: 'd',
  type: ESCROW_TYPE,
  content: escrowBytes(),
});

describe('chainSource.subscribe', () => {
  it('emits the first state then only on version change; aborts cleanly', async () => {
    const versions = ['1', '1', '2', '2', '3'];
    let calls = 0;
    const client = {
      core: {
        getObject: async ({ objectId }: { objectId: string }) => {
          const version = versions[Math.min(calls, versions.length - 1)]!;
          calls += 1;
          return { object: obj(objectId, version) };
        },
      },
    } as unknown as ClientWithCoreApi;

    const ac = new AbortController();
    const src = chainSource(client);
    const seen: string[] = [];
    for await (const s of src.subscribe(id<'Escrow'>('0x' + 'ab'.repeat(32)), {
      pollIntervalMs: 1,
      signal: ac.signal,
    })) {
      seen.push(s.objectId);
      if (seen.length === 3) ac.abort(); // first(v1) + v2 + v3
    }
    expect(seen).toHaveLength(3); // deduped the repeated versions
    expect(calls).toBeGreaterThanOrEqual(5);
  });

  it('stops immediately if the signal is already aborted', async () => {
    const client = {
      core: { getObject: async () => ({ object: obj('0x1', '1') }) },
    } as unknown as ClientWithCoreApi;
    const ac = new AbortController();
    ac.abort();
    const seen: unknown[] = [];
    for await (const s of chainSource(client).subscribe(id<'Escrow'>('0x1'), {
      signal: ac.signal,
    })) {
      seen.push(s);
    }
    expect(seen).toHaveLength(0);
  });
});

describe('chainSource.query', () => {
  const A = '0x' + 'a1'.repeat(32);
  const B = '0x' + 'b2'.repeat(32);
  const owner = '0x' + '99'.repeat(32);

  it('walks owned UsufructCaps to unique escrows, paginated', async () => {
    const pages = [
      {
        objects: [
          { content: capBytes('0x' + '01'.repeat(32), A) },
          { content: capBytes('0x' + '02'.repeat(32), A) }, // dup escrow A
        ],
        hasNextPage: true,
        cursor: 'c1',
      },
      {
        objects: [{ content: capBytes('0x' + '03'.repeat(32), B) }],
        hasNextPage: false,
        cursor: null,
      },
    ];
    let pageIdx = 0;
    const fetched: string[] = [];
    const client = {
      core: {
        listOwnedObjects: async ({ owner: o, type }: { owner: string; type?: string }) => {
          expect(o).toBe(owner);
          expect(type).toBe(`${PKG}::usufruct_cap::UsufructCap`);
          return pages[pageIdx++]!;
        },
        getObject: async ({ objectId }: { objectId: string }) => {
          fetched.push(objectId);
          return { object: obj(objectId, '1') };
        },
      },
    } as unknown as ClientWithCoreApi;

    const src = chainSource(client, { packageId: PKG });
    const ids: string[] = [];
    for await (const s of src.query({ byUsufructuary: owner })) ids.push(s.objectId);

    expect(ids).toEqual([A, B]); // dedup: A once despite two caps
    expect(fetched).toEqual([A, B]); // one getObject per unique escrow
  });

  it('skips caps whose escrow no longer exists (consumed)', async () => {
    const client = {
      core: {
        listOwnedObjects: async () => ({
          objects: [
            { content: capBytes('0x' + '01'.repeat(32), A) }, // alive
            { content: capBytes('0x' + '02'.repeat(32), B) }, // deleted
          ],
          hasNextPage: false,
          cursor: null,
        }),
        getObject: async ({ objectId }: { objectId: string }) => {
          if (objectId === B) throw new Error('Object does not exist (notExists)');
          return { object: obj(objectId, '1') };
        },
      },
    } as unknown as ClientWithCoreApi;
    const ids: string[] = [];
    for await (const s of chainSource(client, { packageId: PKG }).query({
      byUsufructuary: owner,
    })) {
      ids.push(s.objectId);
    }
    expect(ids).toEqual([A]); // B skipped, no throw
  });

  it('throws without packageId', async () => {
    const client = { core: {} } as unknown as ClientWithCoreApi;
    const iter = chainSource(client).query({ byUsufructuary: owner });
    await expect(iter[Symbol.asyncIterator]().next()).rejects.toThrow(/packageId/);
  });
});
