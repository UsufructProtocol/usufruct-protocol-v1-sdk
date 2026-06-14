/**
 * Offline IndexerSource: discovery (by type / asset type / governor) and
 * events, against a fake GraphQL client (query + core.getObject) serving
 * canned docs and codegen-encoded escrow bytes.
 */
import type { SuiGraphQLClient } from '@mysten/sui/graphql';
import { describe, expect, it } from 'vitest';
import { Escrow } from '../src/codegen/usufruct/escrow.js';
import { indexerSource } from '../src/indexer/source.js';
import { uidAssetSchema } from '../src/primitives/state.js';
import { ASSET_ID, defaultCore, defaultCycle } from './synthetic.js';

const PKG = '0x' + '0a'.repeat(32);
const A = '0x' + 'a1'.repeat(32);
const B = '0x' + 'b2'.repeat(32);
const GONE = '0x' + 'cc'.repeat(32);
const DUMMY = '0xa::dummy::DummyAsset';
const OTHER = '0xb::other::OtherAsset';

function escrowBytes(): Uint8Array {
  return Escrow(uidAssetSchema)
    .serialize({
      id: A,
      core: defaultCore,
      state: { Waiting: { Idle: { asset: { asset: { id: ASSET_ID } }, cycle: defaultCycle } } },
    })
    .toBytes();
}

/** asset type per escrow address (for byAssetType filtering). */
const ASSET_OF: Record<string, string> = { [A]: DUMMY, [B]: OTHER };

interface FakePages {
  objects?: Array<{ nodes: { address: string }[]; hasNextPage: boolean; endCursor: string | null }>;
  events?: Array<{
    nodes: { sender: { address: string } | null; contents: { json: Record<string, unknown> } }[];
    hasNextPage: boolean;
    endCursor: string | null;
  }>;
}

function fakeGql(pages: FakePages) {
  let objIdx = 0;
  let evIdx = 0;
  return {
    query: async ({ query }: { query: string }) => {
      if (query.includes('objects(')) {
        const p = pages.objects![objIdx++]!;
        return { data: { objects: { pageInfo: { hasNextPage: p.hasNextPage, endCursor: p.endCursor }, nodes: p.nodes } } };
      }
      const p = pages.events![evIdx++]!;
      return { data: { events: { pageInfo: { hasNextPage: p.hasNextPage, endCursor: p.endCursor }, nodes: p.nodes } } };
    },
    core: {
      getObject: async ({ objectId }: { objectId: string }) => {
        if (objectId === GONE) throw new Error('Object does not exist (notExists)');
        return {
          object: {
            objectId,
            version: '1',
            digest: 'd',
            type: `${PKG}::escrow::Escrow<${ASSET_OF[objectId] ?? DUMMY}, 0x2::sui::SUI>`,
            content: escrowBytes(),
          },
        };
      },
    },
  } as unknown as SuiGraphQLClient;
}

describe('indexerSource discovery', () => {
  it('query({all}) lists every escrow, paginated and deduped', async () => {
    const gql = fakeGql({
      objects: [
        { nodes: [{ address: A }, { address: A }], hasNextPage: true, endCursor: 'c1' },
        { nodes: [{ address: B }], hasNextPage: false, endCursor: null },
      ],
    });
    const ids: string[] = [];
    for await (const s of indexerSource(gql, { packageId: PKG }).query({ all: true })) {
      ids.push(s.objectId);
    }
    expect(ids).toEqual([A, B]);
  });

  it('query({byAssetType}) filters by decoded asset type', async () => {
    const gql = fakeGql({
      objects: [{ nodes: [{ address: A }, { address: B }], hasNextPage: false, endCursor: null }],
    });
    const ids: string[] = [];
    for await (const s of indexerSource(gql, { packageId: PKG }).query({ byAssetType: DUMMY })) {
      ids.push(s.objectId);
    }
    expect(ids).toEqual([A]); // B is OtherAsset
  });

  it('query({byGovernor}) maps AssetIntegrated events to escrows, skipping consumed', async () => {
    const gql = fakeGql({
      events: [
        {
          nodes: [
            { sender: { address: '0x9' }, contents: { json: { escrow_id: A } } },
            { sender: { address: '0x9' }, contents: { json: { escrow_id: A } } }, // dup
            { sender: { address: '0x9' }, contents: { json: { escrow_id: GONE } } }, // consumed
            { sender: { address: '0x9' }, contents: { json: { escrow_id: B } } },
          ],
          hasNextPage: false,
          endCursor: null,
        },
      ],
    });
    const ids: string[] = [];
    for await (const s of indexerSource(gql, { packageId: PKG }).query({ byGovernor: '0x9' })) {
      ids.push(s.objectId);
    }
    expect(ids).toEqual([A, B]); // dup deduped, GONE skipped
  });
});

describe('indexerSource events', () => {
  it('yields parsed payloads across pages', async () => {
    const gql = fakeGql({
      events: [
        {
          nodes: [{ sender: { address: '0x9' }, contents: { json: { escrow_id: A, used_credit: '885' } } }],
          hasNextPage: true,
          endCursor: 'e1',
        },
        {
          nodes: [{ sender: { address: '0x9' }, contents: { json: { escrow_id: B, used_credit: '0' } } }],
          hasNextPage: false,
          endCursor: null,
        },
      ],
    });
    const recs = [];
    for await (const e of indexerSource(gql, { packageId: PKG }).events({
      type: `${PKG}::asset_state::HandoverCompleted`,
    })) {
      recs.push(e);
    }
    expect(recs).toHaveLength(2);
    expect(recs[0]!.json.escrow_id).toBe(A);
    expect(recs[0]!.json.used_credit).toBe('885');
    expect(recs[1]!.json.escrow_id).toBe(B);
  });
});
