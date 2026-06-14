/**
 * Offline typed events + escrowTimeline against a fake GraphQL client serving
 * `contents.bcs` (Base64 of codegen-serialized events — the MoveValue's pure
 * struct bytes). Proves events are BCS-decoded with the codegen structs and the
 * timeline filters by escrow_id client-side (GraphQL can't filter a payload).
 */
import type { SuiGraphQLClient } from '@mysten/sui/graphql';
import { toBase64 } from '@mysten/sui/utils';
import { describe, expect, it } from 'vitest';
import { HandoverCompleted, TenureExpired } from '../src/codegen/usufruct/asset_state.js';
import { id } from '../src/primitives/brand.js';
import { indexerSource } from '../src/indexer/source.js';
import { normEscrowId } from '../src/indexer/events.js';

const PKG = '0x' + '0a'.repeat(32);
const A = '0x' + 'a1'.repeat(32);
const B = '0x' + 'b2'.repeat(32);
const ADDR = '0x' + '11'.repeat(32);

const handoverBcs = (escrowId: string) =>
  toBase64(
    HandoverCompleted.serialize({
      escrow_id: escrowId,
      asset_type: '0xa::dummy::DummyAsset',
      coin_type: '0x2::sui::SUI',
      departing_usufruct_cap_id: ADDR,
      departing_usufructuary_address: ADDR,
      departing_phase_start_ms: 0n,
      departing_ceiling_total_ms: 0n,
      departing_handover_total_ms: 0n,
      active_usufruct_cap_id: ADDR,
      active_usufructuary_address: ADDR,
      active_stake_balance: 2_000n,
      used_credit: 1_000n,
      remain_credit: 0n,
      governor_share: 900n,
      protocol_fee: 100n,
      departing_refund_amount: 0n,
      new_rent_price: 1_001n,
      committed_tenures: 2n,
      ceiling_total_ms: 0n,
      handover_total_ms: 0n,
      timestamp_ms: 100n,
    }).toBytes(),
  );

const tenureBcs = (escrowId: string) =>
  toBase64(
    TenureExpired.serialize({
      escrow_id: escrowId,
      asset_type: '0xa::dummy::DummyAsset',
      coin_type: '0x2::sui::SUI',
      usufruct_cap_id: ADDR,
      usufructuary_address: ADDR,
      phase_start_ms: 0n,
      governor_share: 900n,
      protocol_fee: 100n,
      last_acquisition_price: 1_000n,
      timestamp_ms: 200n,
    }).toBytes(),
  );

/** node: { sender, timestamp, contents:{ bcs, json } } — the indexer's shape. */
const node = (bcs: string, escrowId: string, timestamp: string) => ({
  sender: { address: ADDR },
  timestamp,
  contents: { bcs, json: { escrow_id: escrowId } },
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
  it('events() BCS-decodes contents.bcs to the codegen struct and extracts escrowId', async () => {
    const gql = fakeGql({ HandoverCompleted: [node(handoverBcs(A), A, '2024-01-01T00:00:01Z')] });
    const recs = [];
    for await (const e of indexerSource(gql, { packageId: PKG }).events({
      type: `${PKG}::asset_state::HandoverCompleted`,
    })) {
      recs.push(e);
    }
    expect(recs).toHaveLength(1);
    const e = recs[0]!;
    expect(e.name).toBe('HandoverCompleted');
    expect(e.escrowId).toBe(normEscrowId(A)); // from the BCS-decoded escrow_id
    expect(e.data.governor_share).toBe('900'); // BCS-decoded, not the stub json
    expect(e.data.new_rent_price).toBe('1001');
  });
});

describe('indexer escrowTimeline', () => {
  it('fans out, keeps only the asked escrow, and orders by time', async () => {
    const gql = fakeGql({
      HandoverCompleted: [
        node(handoverBcs(A), A, '2024-01-01T00:00:01Z'),
        node(handoverBcs(B), B, '2024-01-01T00:00:00Z'), // other escrow → excluded
      ],
      TenureExpired: [node(tenureBcs(A), A, '2024-01-01T00:00:02Z')],
    });
    const timeline = await indexerSource(gql, { packageId: PKG }).escrowTimeline(id<'Escrow'>(A), {
      types: ['asset_state::HandoverCompleted', 'asset_state::TenureExpired'],
    });
    expect(timeline.map((e) => e.name)).toEqual(['HandoverCompleted', 'TenureExpired']); // time order
    expect(timeline.every((e) => e.escrowId === normEscrowId(A))).toBe(true); // B excluded
  });
});
