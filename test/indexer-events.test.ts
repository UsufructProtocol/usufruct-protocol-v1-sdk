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

/** node: the indexer's shape, carrying its own `contents.type.repr`. */
const node = (repr: string, bcs: string | null, escrowId: string, timestamp: string) => ({
  sender: { address: ADDR },
  timestamp,
  contents: { type: { repr }, bcs, json: { escrow_id: escrowId } },
});

/** Fake GraphQL for the `events()` path: serves an exact-type `EventFilter`. */
function fakeEventsGql(nodes: ReturnType<typeof node>[]) {
  const client = {
    query: async ({ variables }: { variables: { type: string } }) => ({
      data: {
        events: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: nodes.filter((n) => n.contents.type.repr === variables.type),
        },
      },
    }),
    core: {},
  } as unknown as SuiGraphQLClient;
  return { client };
}

/** A transaction grouping events (the `affectedObject` timeline shape). */
const tx = (timestamp: string, ...evs: ReturnType<typeof node>[]) => ({
  effects: { timestamp, events: { nodes: evs } },
});

/**
 * Fake GraphQL for the `escrowTimeline` path: serves `transactions(filter:{
 * affectedObject })` from a flat tx list, and counts `query` calls (so a test can
 * assert the timeline is a single object-scoped walk, not a 25-way fan-out).
 */
function fakeTxGql(txs: ReturnType<typeof tx>[]) {
  let calls = 0;
  const client = {
    query: async () => {
      calls += 1;
      return {
        data: {
          transactions: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: txs },
        },
      };
    },
    core: {},
  } as unknown as SuiGraphQLClient;
  return { client, calls: () => calls };
}

const REPR = (name: string) => `${PKG}::asset_state::${name}`;

describe('indexer typed events', () => {
  it('events() BCS-decodes contents.bcs to the codegen struct and extracts escrowId', async () => {
    const { client } = fakeEventsGql([node(REPR('HandoverCompleted'), handoverBcs(A), A, '2024-01-01T00:00:01Z')]);
    const recs = [];
    for await (const e of indexerSource(client, { packageId: PKG }).events({
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
  it('walks the escrow’s transactions: keeps only this escrow + escrow-keyed types, time-ordered', async () => {
    const { client, calls } = fakeTxGql([
      // a tenure-expiry tx (later) — a single tx can emit several events…
      tx(
        '2024-01-01T00:00:02Z',
        node(REPR('TenureExpired'), tenureBcs(A), A, '2024-01-01T00:00:02Z'),
        // …and a non-escrow-keyed one → excluded by the allowlist
        node(`${PKG}::governance_cap::GovernanceCapBurned`, null, A, '2024-01-01T00:00:02Z'),
      ),
      // a handover tx (earlier) that also touched another escrow B → B excluded by escrow_id
      tx(
        '2024-01-01T00:00:01Z',
        node(REPR('HandoverCompleted'), handoverBcs(A), A, '2024-01-01T00:00:01Z'),
        node(REPR('HandoverCompleted'), handoverBcs(B), B, '2024-01-01T00:00:01Z'),
      ),
    ]);
    const timeline = await indexerSource(client, { packageId: PKG }).escrowTimeline(id<'Escrow'>(A));
    expect(timeline.map((e) => e.name)).toEqual(['HandoverCompleted', 'TenureExpired']); // time order
    expect(timeline.every((e) => e.escrowId === normEscrowId(A))).toBe(true); // B excluded
    expect(calls()).toBe(1); // one object-scoped walk, not a 25-way fan-out
  });
});
