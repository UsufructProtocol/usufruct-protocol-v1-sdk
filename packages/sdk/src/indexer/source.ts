/**
 * IndexerSource (SPEC §4.4 / §6.3) — the non-core convenience layer for what
 * the core API cannot do: discover escrows by governor or asset type (escrows
 * are shared, so not listable by owner), enumerate every escrow, and read
 * event history. Powered by GraphQL (`SuiGraphQLClient`).
 *
 * It is `Source`-conformant: `fetch`/`subscribe`/`query({byUsufructuary})`
 * delegate to a `chainSource` over the same GraphQL client (whose `.core`
 * implements the core API); `query`'s indexer-only predicates and `events`
 * use raw GraphQL. Downstream that consumes `Source` cannot tell the two
 * apart.
 *
 * Note: a GraphQL indexer lags the fullnode — freshly-written objects/events
 * may not appear immediately. Reads reflect the index.
 */
import type { SuiGraphQLClient } from '@mysten/sui/graphql';
import type { ClientWithCoreApi } from '@mysten/sui/client';
import type { Id } from '../primitives/brand.js';
import { escrowTypeArgs, type EscrowSnapshot } from '../primitives/state.js';
import {
  chainSource,
  isMissingObject,
  type Predicate,
  type Source,
  type SubscribeOpts,
} from '../primitives/source.js';
import { ESCROW_KEYED, eventKey, normEscrowId, toTypedEvent, type TypedEvent } from './events.js';

/** @deprecated use `TypedEvent` (a superset). Kept for source compatibility. */
export type EventRecord = TypedEvent;

export interface EventsFilter {
  /** Fully-qualified event type, e.g. `${pkg}::asset_state::HandoverCompleted`. */
  readonly type: string;
  /** Restrict to events emitted by transactions this address signed. */
  readonly sender?: string;
  /** Page size (default 50). */
  readonly pageSize?: number;
  /** Bound history to events after / before these checkpoints (EventFilter). */
  readonly afterCheckpoint?: number;
  readonly beforeCheckpoint?: number;
}

export interface TimelineOpts {
  /** Event names (`module::Name`) to keep (default: every escrow-keyed event). A
   *  client-side allowlist over the escrow's transactions. */
  readonly types?: readonly string[];
  /**
   * Restrict to transactions this address signed (`sentAddress`) — narrows the
   * escrow's tx walk to one actor. Omit for the full timeline across all actors.
   */
  readonly sender?: string;
  readonly afterCheckpoint?: number;
  readonly beforeCheckpoint?: number;
  readonly pageSize?: number;
}

export interface IndexerSource extends Source {
  /** Event history of one type (typed, BCS-decoded). */
  readonly events: (filter: EventsFilter) => AsyncIterable<TypedEvent>;
  /** An escrow's full timeline: fan out the escrow-keyed events, merge, sort by time. */
  readonly escrowTimeline: (
    escrowId: Id<'Escrow'>,
    opts?: TimelineOpts,
  ) => Promise<TypedEvent[]>;
}

export interface IndexerOpts {
  readonly packageId: string;
  /** GraphQL page size for discovery (default 50). */
  readonly pageSize?: number;
}

const OBJECTS_DOC = `query($type: String!, $after: String, $first: Int!) {
  objects(first: $first, after: $after, filter: { type: $type }) {
    pageInfo { hasNextPage endCursor }
    nodes { address }
  }
}`;

const EVENTS_DOC = `query($type: String!, $sender: SuiAddress, $after: String, $first: Int!, $afterCp: UInt53, $beforeCp: UInt53) {
  events(first: $first, after: $after, filter: { type: $type, sender: $sender, afterCheckpoint: $afterCp, beforeCheckpoint: $beforeCp }) {
    pageInfo { hasNextPage endCursor }
    nodes { sender { address } timestamp contents { type { repr } bcs json } }
  }
}`;

// An escrow's timeline = the transactions that *touched the escrow object*
// (`affectedObject`) and the events those transactions emitted. This is O(the
// escrow's own lifecycle), not O(package history) — and it is the only correct
// shape: a `type`-prefix events scan silently truncates on the public endpoint
// (confirmed live), while exact-type-per-event needs a 25-way fan-out.
const TX_DOC = `query($obj: SuiAddress!, $sent: SuiAddress, $after: String, $first: Int!, $afterCp: UInt53, $beforeCp: UInt53) {
  transactions(first: $first, after: $after, filter: { affectedObject: $obj, sentAddress: $sent, afterCheckpoint: $afterCp, beforeCheckpoint: $beforeCp }) {
    pageInfo { hasNextPage endCursor }
    nodes { effects { timestamp events { nodes { sender { address } contents { type { repr } bcs json } } } } }
  }
}`;

type ObjectsResult = {
  objects: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: { address: string }[];
  };
};
type EventNode = {
  sender: { address: string } | null;
  timestamp: string | null;
  contents: { type: { repr: string } | null; bcs: string | null; json: Record<string, unknown> };
};
type EventsResult = {
  events: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: EventNode[];
  };
};
type TxNode = {
  effects: {
    timestamp: string | null;
    events: { nodes: EventNode[] } | null;
  } | null;
};
type TxResult = {
  transactions: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: TxNode[];
  };
};

function normalizeType(t: string): string {
  // Compare asset types ignoring 0x and leading-zero padding differences.
  return t.replace(/^0x/, '').replace(/<0x/g, '<').toLowerCase();
}

export function indexerSource(gql: SuiGraphQLClient, opts: IndexerOpts): IndexerSource {
  const first = opts.pageSize ?? 50;
  const base = chainSource(gql as unknown as ClientWithCoreApi, {
    packageId: opts.packageId,
  });

  async function run<R>(query: string, variables: Record<string, unknown>): Promise<R> {
    const res = await gql.query<R>({ query, variables });
    if (res.errors?.length) throw new Error(`GraphQL: ${res.errors.map((e) => e.message).join('; ')}`);
    if (!res.data) throw new Error('GraphQL: empty response');
    return res.data;
  }

  /** Fetch an escrow id's raw snapshot, skipping ones already consumed (deleted). */
  async function* fetchEach(ids: Iterable<string>): AsyncIterable<EscrowSnapshot> {
    for (const escrowId of ids) {
      try {
        yield await base.fetch(escrowId as Id<'Escrow'>);
      } catch (e) {
        if (isMissingObject(e)) continue;
        throw e;
      }
    }
  }

  async function* byType(assetFilter?: string): AsyncIterable<EscrowSnapshot> {
    const type = `${opts.packageId}::escrow::Escrow`;
    const want = assetFilter ? normalizeType(assetFilter) : null;
    let after: string | null = null;
    const seen = new Set<string>();
    do {
      const { objects }: ObjectsResult = await run(OBJECTS_DOC, { type, after, first });
      const ids = objects.nodes.map((n) => n.address).filter((a) => !seen.has(a) && seen.add(a));
      for await (const st of fetchEach(ids)) {
        if (want && normalizeType(escrowTypeArgs(st.type)[0]) !== want) continue;
        yield st;
      }
      after = objects.pageInfo.hasNextPage ? objects.pageInfo.endCursor : null;
    } while (after);
  }

  async function* byGovernor(governor: string): AsyncIterable<EscrowSnapshot> {
    const type = `${opts.packageId}::asset_state::AssetIntegrated`;
    let after: string | null = null;
    const seen = new Set<string>();
    do {
      const { events }: EventsResult = await run(EVENTS_DOC, {
        type,
        sender: governor,
        after,
        first,
      });
      const ids = events.nodes
        .map((n) => String(n.contents.json.escrow_id))
        .filter((id) => !seen.has(id) && seen.add(id));
      yield* fetchEach(ids);
      after = events.pageInfo.hasNextPage ? events.pageInfo.endCursor : null;
    } while (after);
  }

  /**
   * Page a GraphQL `events` query by **exact type** (`pkg::module::Name`), typed
   * and BCS-decoded. (A `type`-prefix filter — package or module — is *not* used:
   * the public endpoint silently truncates a broad prefix scan, confirmed live.
   * Per-escrow history goes through `escrowTimeline`'s `affectedObject` walk.)
   * Each `TypedEvent` carries its own type from `contents.type.repr`.
   */
  async function* pageEvents(
    typeFilter: string,
    p: {
      sender?: string;
      afterCheckpoint?: number;
      beforeCheckpoint?: number;
      pageSize?: number;
    },
  ): AsyncIterable<TypedEvent> {
    let after: string | null = null;
    const pageFirst = p.pageSize ?? first;
    do {
      const { events }: EventsResult = await run(EVENTS_DOC, {
        type: typeFilter,
        sender: p.sender ?? null,
        after,
        first: pageFirst,
        afterCp: p.afterCheckpoint ?? null,
        beforeCp: p.beforeCheckpoint ?? null,
      });
      for (const n of events.nodes) {
        yield toTypedEvent({
          type: n.contents.type?.repr ?? typeFilter,
          sender: n.sender?.address ?? null,
          timestamp: n.timestamp,
          bcs: n.contents.bcs,
          json: n.contents.json,
        });
      }
      after = events.pageInfo.hasNextPage ? events.pageInfo.endCursor : null;
    } while (after);
  }

  return {
    fetch: base.fetch,
    subscribe: (id: Id<'Escrow'>, subOpts?: SubscribeOpts) => base.subscribe(id, subOpts),

    query: (predicate: Predicate) => {
      if ('byUsufructuary' in predicate) return base.query(predicate);
      if ('byGovernor' in predicate) return byGovernor(predicate.byGovernor);
      if ('byAssetType' in predicate) return byType(predicate.byAssetType);
      return byType(); // { all: true }
    },

    events: (filter) =>
      pageEvents(filter.type, {
        ...(filter.sender !== undefined ? { sender: filter.sender } : {}),
        ...(filter.afterCheckpoint !== undefined ? { afterCheckpoint: filter.afterCheckpoint } : {}),
        ...(filter.beforeCheckpoint !== undefined
          ? { beforeCheckpoint: filter.beforeCheckpoint }
          : {}),
        ...(filter.pageSize !== undefined ? { pageSize: filter.pageSize } : {}),
      }),

    async escrowTimeline(escrowId, timelineOpts) {
      const want = normEscrowId(escrowId);
      const allow = new Set(timelineOpts?.types ?? ESCROW_KEYED); // `module::Name`
      const pageFirst = timelineOpts?.pageSize ?? first;
      const sent = timelineOpts?.sender ?? null;
      const afterCp = timelineOpts?.afterCheckpoint ?? null;
      const beforeCp = timelineOpts?.beforeCheckpoint ?? null;

      // Walk the transactions that touched THIS escrow object and read the events
      // they emitted — O(the escrow's own lifecycle), not O(package history).
      // A tx may touch several escrows, so still filter by `escrow_id`; the
      // allowlist drops non-escrow-keyed package events (e.g. *Collected).
      const out: TypedEvent[] = [];
      let after: string | null = null;
      do {
        const { transactions }: TxResult = await run(TX_DOC, {
          obj: escrowId,
          sent,
          after,
          first: pageFirst,
          afterCp,
          beforeCp,
        });
        for (const tx of transactions.nodes) {
          const ts = tx.effects?.timestamp ?? null;
          for (const n of tx.effects?.events?.nodes ?? []) {
            const e = toTypedEvent({
              type: n.contents.type?.repr ?? '',
              sender: n.sender?.address ?? null,
              timestamp: ts,
              bcs: n.contents.bcs,
              json: n.contents.json,
            });
            if (allow.has(eventKey(e.type)) && e.escrowId === want) out.push(e);
          }
        }
        after = transactions.pageInfo.hasNextPage ? transactions.pageInfo.endCursor : null;
      } while (after);

      // Order by emission time (ISO string sorts chronologically); ties broken by
      // event name for determinism.
      return out.sort((a, b) => {
        const t = (a.timestamp ?? '').localeCompare(b.timestamp ?? '');
        return t !== 0 ? t : a.name.localeCompare(b.name);
      });
    },
  };
}
