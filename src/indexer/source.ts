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

export interface EventRecord {
  readonly type: string;
  readonly sender: string | null;
  /** The Move struct payload, parsed by the indexer. */
  readonly json: Record<string, unknown>;
}

export interface EventsFilter {
  /** Fully-qualified event type, e.g. `${pkg}::asset_state::HandoverCompleted`. */
  readonly type: string;
  /** Restrict to events emitted by transactions this address signed. */
  readonly sender?: string;
  /** Page size (default 50). */
  readonly pageSize?: number;
}

export interface IndexerSource<
  A extends AssetSchema = typeof uidAssetSchema,
  C extends string = string,
> extends Source<A, C> {
  /** Event history (timeline / analytics). Per-escrow = filter by json.escrow_id. */
  readonly events: (filter: EventsFilter) => AsyncIterable<EventRecord>;
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

const EVENTS_DOC = `query($type: String!, $sender: SuiAddress, $after: String, $first: Int!) {
  events(first: $first, after: $after, filter: { type: $type, sender: $sender }) {
    pageInfo { hasNextPage endCursor }
    nodes { sender { address } contents { json } }
  }
}`;

type ObjectsResult = {
  objects: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: { address: string }[];
  };
};
type EventsResult = {
  events: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: { sender: { address: string } | null; contents: { json: Record<string, unknown> } }[];
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

  return {
    fetch: base.fetch,
    subscribe: (id: Id<'Escrow'>, subOpts?: SubscribeOpts) => base.subscribe(id, subOpts),

    query: (predicate: Predicate) => {
      if ('byUsufructuary' in predicate) return base.query(predicate);
      if ('byGovernor' in predicate) return byGovernor(predicate.byGovernor);
      if ('byAssetType' in predicate) return byType(predicate.byAssetType);
      return byType(); // { all: true }
    },

    events: async function* (filter) {
      let after: string | null = null;
      const pageFirst = filter.pageSize ?? first;
      do {
        const { events }: EventsResult = await run(EVENTS_DOC, {
          type: filter.type,
          sender: filter.sender ?? null,
          after,
          first: pageFirst,
        });
        for (const n of events.nodes) {
          yield { type: filter.type, sender: n.sender?.address ?? null, json: n.contents.json };
        }
        after = events.pageInfo.hasNextPage ? events.pageInfo.endCursor : null;
      } while (after);
    },
  };
}
