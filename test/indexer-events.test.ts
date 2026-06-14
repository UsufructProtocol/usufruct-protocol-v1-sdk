/**
 * Offline typed events + escrowTimeline against a fake GraphQL client. Events
 * are typed from the indexer's `contents.json` (the ABI-correct payload); the
 * timeline fans the escrow-keyed types and filters by escrow_id client-side
 * (GraphQL can't filter a payload field).
 */
import type { SuiGraphQLClient } from '@mysten/sui/graphql';
import { describe, expect, it } from 'vitest';
import { id } from '../src/primitives/brand.js';
import { indexerSource } from '../src/indexer/source.js';
import { normEscrowId } from '../src/indexer/events.js';

const PKG = '0x' + '0a'.repeat(32);
const A = '0x' + 'a1'.repeat(32);
const B = '0x' + 'b2'.repeat(32);
const ADDR = '0x' + '11'.repeat(32);

/** node: { sender, timestamp, contents:{json} } — the indexer's shape. */
const node = (json: Record<string, unknown>, timestamp: string) => ({
  sender: { address: ADDR },
  timestamp,
  contents: { json },
});

const handover = (escrowId: string) => ({
  escrow_id: escrowId,
  governor_share: '900',
  protocol_fee: '100',
  new_rent_price: '1001',
});
const tenure = (escrowId: string) => ({
  escrow_id: escrowId,
  governor_share: '900',
  protocol_fee: '100',
});

/** Fake GraphQL serving events by `type`; `pages[name]` holds that type's nodes. */
function fakeGql(pages: Record<string, ReturnType<typeof node>[]>) {
  return {
    query: async ({ variables }: { variables: { type: string } }) => {
      const name = variables.type.split('::').pop()!;
      return {
        data: {
          events: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: pages[name] ?? [] },
        },
      };
    },
    core: {},
  } as unknown as SuiGraphQLClient;
}

describe('indexer typed events', () => {
  it('events() yields a typed record with module/name/escrowId from the payload', async () => {
    const gql = fakeGql({ HandoverCompleted: [node(handover(A), '2024-01-01T00:00:01Z')] });
    const recs = [];
    for await (const e of indexerSource(gql, { packageId: PKG }).events({
      type: `${PKG}::asset_state::HandoverCompleted`,
    })) {
      recs.push(e);
    }
    expect(recs).toHaveLength(1);
    const e = recs[0]!;
    expect(e.name).toBe('HandoverCompleted');
    expect(e.module).toBe('asset_state');
    expect(e.escrowId).toBe(normEscrowId(A));
    expect(e.data.governor_share).toBe('900');
    expect(e.data.new_rent_price).toBe('1001');
  });
});

describe('indexer escrowTimeline', () => {
  it('fans out, keeps only the asked escrow, and orders by time', async () => {
    const gql = fakeGql({
      HandoverCompleted: [
        node(handover(A), '2024-01-01T00:00:01Z'),
        node(handover(B), '2024-01-01T00:00:00Z'), // other escrow → excluded
      ],
      TenureExpired: [node(tenure(A), '2024-01-01T00:00:02Z')],
    });
    const timeline = await indexerSource(gql, { packageId: PKG }).escrowTimeline(id<'Escrow'>(A), {
      types: ['asset_state::HandoverCompleted', 'asset_state::TenureExpired'],
    });
    expect(timeline.map((e) => e.name)).toEqual(['HandoverCompleted', 'TenureExpired']); // time order
    expect(timeline.every((e) => e.escrowId === normEscrowId(A))).toBe(true); // B excluded
  });
});
