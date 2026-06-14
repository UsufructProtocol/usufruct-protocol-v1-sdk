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
import type { AssetSchema, EscrowState, uidAssetSchema } from '../primitives/state.js';
import {
  chainSource,
  isMissingObject,
  type Predicate,
  type Source,
  type SubscribeOpts,
} from '../primitives/source.js';
import { ESCROW_KEYED, normEscrowId, toTypedEvent, type TypedEvent } from './events.js';

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
  /** Event names (`module::Name`) to fan out over (default: every escrow-keyed event). */
  readonly types?: readonly string[];
  /**
   * Restrict to events emitted by transactions this address signed — narrows
   * the fan-out (and avoids scanning unrelated history the indexer may have
   * pruned). Omit for the full timeline across all actors.
   */
  readonly sender?: string;
  readonly afterCheckpoint?: number;
  readonly beforeCheckpoint?: number;
  readonly pageSize?: number;
}

export interface IndexerSource<
  A extends AssetSchema = typeof uidAssetSchema,
  C extends string = string,
> extends Source<A, C> {
  /** Event history of one type (typed, BCS-decoded). */
  readonly events: (filter: EventsFilter) => AsyncIterable<TypedEvent>;
  /** An escrow's full timeline: fan out the escrow-keyed events, merge, sort by time. */
  readonly escrowTimeline: (
    escrowId: Id<'Escrow'>,
    opts?: TimelineOpts,
  ) => Promise<TypedEvent[]>;
}

export interface IndexerOpts<A extends AssetSchema> {
  readonly packageId: string;
  readonly assetSchema?: A;
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
    nodes { sender { address } timestamp contents { bcs json } }
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
  contents: { bcs: string | null; json: Record<string, unknown> };
};
type EventsResult = {
  events: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: EventNode[];
  };
};

function normalizeType(t: string): string {
  // Compare asset types ignoring 0x and leading-zero padding differences.
  return t.replace(/^0x/, '').replace(/<0x/g, '<').toLowerCase();
}

export function indexerSource<
  A extends AssetSchema = typeof uidAssetSchema,
  C extends string = string,
>(gql: SuiGraphQLClient, opts: IndexerOpts<A>): IndexerSource<A, C> {
  const first = opts.pageSize ?? 50;
  const base = chainSource<A, C>(gql as unknown as ClientWithCoreApi, {
    ...(opts.assetSchema !== undefined ? { assetSchema: opts.assetSchema } : {}),
    packageId: opts.packageId,
  });

  async function run<R>(query: string, variables: Record<string, unknown>): Promise<R> {
    const res = await gql.query<R>({ query, variables });
    if (res.errors?.length) throw new Error(`GraphQL: ${res.errors.map((e) => e.message).join('; ')}`);
    if (!res.data) throw new Error('GraphQL: empty response');
    return res.data;
  }

  /** Fetch+decode an escrow id, skipping ones already consumed (deleted). */
  async function* fetchEach(ids: Iterable<string>): AsyncIterable<EscrowState<A, C>> {
    for (const escrowId of ids) {
      try {
        yield await base.fetch(escrowId as Id<'Escrow'>);
      } catch (e) {
        if (isMissingObject(e)) continue;
        throw e;
      }
    }
  }

  async function* byType(assetFilter?: string): AsyncIterable<EscrowState<A, C>> {
    const type = `${opts.packageId}::escrow::Escrow`;
    const want = assetFilter ? normalizeType(assetFilter) : null;
    let after: string | null = null;
    const seen = new Set<string>();
    do {
      const { objects }: ObjectsResult = await run(OBJECTS_DOC, { type, after, first });
      const ids = objects.nodes.map((n) => n.address).filter((a) => !seen.has(a) && seen.add(a));
      for await (const st of fetchEach(ids)) {
        if (want && normalizeType(st.assetType) !== want) continue;
        yield st;
      }
      after = objects.pageInfo.hasNextPage ? objects.pageInfo.endCursor : null;
    } while (after);
  }

  async function* byGovernor(governor: string): AsyncIterable<EscrowState<A, C>> {
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

  /** Page one event type (typed, BCS-decoded). The single GraphQL events call. */
  async function* pageEvents(
    fullType: string,
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
        type: fullType,
        sender: p.sender ?? null,
        after,
        first: pageFirst,
        afterCp: p.afterCheckpoint ?? null,
        beforeCp: p.beforeCheckpoint ?? null,
      });
      for (const n of events.nodes) {
        yield toTypedEvent({
          type: fullType,
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
      const names = timelineOpts?.types ?? ESCROW_KEYED;
      const per = {
        ...(timelineOpts?.sender !== undefined ? { sender: timelineOpts.sender } : {}),
        ...(timelineOpts?.afterCheckpoint !== undefined
          ? { afterCheckpoint: timelineOpts.afterCheckpoint }
          : {}),
        ...(timelineOpts?.beforeCheckpoint !== undefined
          ? { beforeCheckpoint: timelineOpts.beforeCheckpoint }
          : {}),
        ...(timelineOpts?.pageSize !== undefined ? { pageSize: timelineOpts.pageSize } : {}),
      };
      // Fan out the escrow-keyed event types and filter by escrow_id client-side
      // (the GraphQL filter can't match a payload field). Bound the concurrency
      // so we don't burst the indexer — a public endpoint drops parallel queries
      // under load. Errors propagate (the caller retries); decode is best-effort.
      const oneType = async (n: string): Promise<TypedEvent[]> => {
        const out: TypedEvent[] = [];
        for await (const e of pageEvents(`${opts.packageId}::${n}`, per)) {
          if (e.escrowId === want) out.push(e);
        }
        return out;
      };
      const CONCURRENCY = 5;
      const lists: TypedEvent[][] = [];
      for (let i = 0; i < names.length; i += CONCURRENCY) {
        lists.push(...(await Promise.all(names.slice(i, i + CONCURRENCY).map(oneType))));
      }
      // Merge and order by emission time (ISO string sorts chronologically);
      // ties broken by event name for determinism.
      return lists.flat().sort((a, b) => {
        const t = (a.timestamp ?? '').localeCompare(b.timestamp ?? '');
        return t !== 0 ? t : a.name.localeCompare(b.name);
      });
    },
  };
}
