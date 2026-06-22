/**
 * `usufruct()` — the entry point and single IO mediator for the high-level
 * API (Layer 2). It hides transport choice / URL / `ClientWithCoreApi`, holds
 * the (optional) signer, and is the door onto the authority graph.
 *
 * Phase A: the factory, client/signer plumbing, and the `primitives` escape
 * hatch. `escrow` / `coinType` are declared here and implemented in Phases B–C.
 */
import type { ClientWithCoreApi } from '@mysten/sui/client';
import type { Signer } from '@mysten/sui/cryptography';
import { SuiGraphQLClient } from '@mysten/sui/graphql';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { integrateToPtb as integrateAction } from '../actions/integrate.js';
import { UsufructCap as UsufructCapBcs } from '../codegen/usufruct/usufruct_cap.js';
import { TESTNET } from '../config/network.js';
import { indexerSource, type IndexerSource } from '../indexer/index.js';
import { fetchTypeArgs } from './typeargs.js';
import { chainSource, type Source } from '../primitives/source.js';
import { createReader, type Reader, type ReaderTarget } from '../read/reader.js';
import { id as toId } from '../primitives/brand.js';
import { createCap, type UsufructCap } from './cap.js';
import type { HandleCtx } from './ctx.js';
import { createEscrow, createEscrowMany, type Escrow } from './escrow.js';
import { createGovernanceCap, type GovernanceCap } from './governanceCap.js';
import { createInbox, type EarningsInbox, type ProtocolFeeInbox } from './inbox.js';
import { resolveFeeInboxId } from './feeref.js';
import { normalizeStructTag } from '@mysten/sui/utils';
import { resolveCoinTag } from './coinmeta.js';
import { discoverIntegrated, type EscrowListing } from './listings.js';
import { ownedIds } from './role.js';
import { makePlan, type Plan } from './plan.js';
import { type Market, toEnsembleConfig } from './market.js';
import { retryingClient, retryingGraphqlClient, retryingReader, type RetryOptions } from './retry.js';
import { watchMany, type PortfolioWatch } from './watch-many.js';
import { createdIdByType, signerExecutor, type Executor } from './send.js';
import type { CoinTag } from './value.js';

/** Tell a `Signer` from an `Executor` (the latter has `execute`). */
function isExecutor(x: Signer | Executor): x is Executor {
  return typeof (x as Executor).execute === 'function';
}

export type Network = 'testnet' | 'mainnet' | 'devnet' | 'localnet';

/** Explicit time. Defaults to the fetched chain clock (never the local clock). */
export type When = Date | number | 'now';

const GRPC_URL: Record<Network, string> = {
  testnet: 'https://fullnode.testnet.sui.io:443',
  mainnet: 'https://fullnode.mainnet.sui.io:443',
  devnet: 'https://fullnode.devnet.sui.io:443',
  localnet: 'http://127.0.0.1:9000',
};

/** The public GraphQL endpoint per network — the default for `inspect.*` discovery.
 *  No `localnet` entry (no standard local indexer): there you must pass `graphql`. */
const GRAPHQL_URL: Partial<Record<Network, string>> = {
  testnet: 'https://graphql.testnet.sui.io/graphql',
  mainnet: 'https://graphql.mainnet.sui.io/graphql',
  devnet: 'https://graphql.devnet.sui.io/graphql',
};

export interface UsufructConfig {
  /** Pick a known network (builds a gRPC client). Default `'testnet'`. */
  readonly network?: Network;
  /** Bring your own transport (gRPC / JSON-RPC). Overrides `network`. */
  readonly client?: ClientWithCoreApi;
  /**
   * Sugar for `account` + `executor`: a held keypair both identifies you and
   * signs. Required only when you want the SDK to sign; reads need none.
   */
  readonly signer?: Signer;
  /**
   * Identity only — *who I am* (an address). Lets reads resolve roles and writes
   * build with the right sender, without holding keys (a browser wallet exposes
   * its address but signs remotely). With `account` but no `executor`/`signer`,
   * `.send()` requires an explicit `Executor`.
   */
  readonly account?: string;
  /** Default signing for `.send()`. A wallet / Ledger / sponsor adapter. Overridable per `.send(executor)`. */
  readonly executor?: Executor;
  /** Defaults to the network's deployed package id. */
  readonly packageId?: string;
  /** The frozen `ProtocolFeeRef` consumed by `integrate`; defaults to the network's. */
  readonly feeRefId?: string;
  /**
   * GraphQL endpoint (URL or client) for `inspect.*` discovery/history. **Defaults
   * to the network's public endpoint** (testnet/mainnet/devnet), so `network: 'testnet'`
   * already enables `inspect.*` — pass this only to use a custom endpoint, a
   * preconfigured client, or `false` to disable discovery (then `inspect.*` throws).
   * On `localnet` there is no default — supply your own.
   */
  readonly graphql?: string | SuiGraphQLClient | false;
  /**
   * Retry policy for transient public-fullnode faults (429/502/503 and truncated
   * reads). On by default — reads ride through flakiness; execution never retries.
   * Pass an object to tune (`attempts`, `baseMs`), or `false` to disable.
   */
  readonly retry?: { attempts?: number; baseMs?: number } | false;
}

/** The raw kernel, one property away (escape hatch — SPEC rule #2). */
export interface Primitives {
  readonly source: Source;
  /** Build a drift-free `Reader` for an escrow target (needs its type args). */
  reader(target: ReaderTarget): Reader;
}

// ── the four-verb surface at GLOBAL scope (additive; fractal with the object
//    handles). `nav` zooms the whole protocol down to one object handle. ──
/** nav — navigate to an object you know by id (zoom from the protocol to a node). */
export interface RootNavVerb {
  escrow(id: string, opts?: { at?: When }): Promise<Escrow>;
  escrows(ids: string[], opts?: { at?: When }): Promise<Escrow[]>;
  usufructCap(id: string): Promise<UsufructCap>;
  governanceCap(id: string): GovernanceCap;
  earningsInbox(id: string): EarningsInbox;
  feeInbox(id?: string): Promise<ProtocolFeeInbox>;
}
/** read — global protocol state (module-level constant views). */
export interface RootReadVerb {
  protocolFeeBps(): Promise<number>;
  bpsDenominator(): Promise<number>;
}
/** inspect — global discovery: ask the event log which escrows exist by relationship. */
export interface RootInspectVerb {
  integratedBy(integrator: string): Promise<EscrowListing[]>;
  governedBy(holder: string): Promise<EscrowListing[]>;
  rentedBy(holder: string): Promise<EscrowListing[]>;
  governedByCap(governanceCapId: string): Promise<EscrowListing[]>;
  byAssetType(assetType: string): Promise<EscrowListing[]>;
  byCoinType(coinType: string): Promise<EscrowListing[]>;
}
/** react — global subscriptions across many escrows over one firehose. */
export interface RootReactVerb {
  watchMany(escrowIds: string[], onChange: (e: Escrow) => void, opts?: { intervalMs?: number }): PortfolioWatch;
}
/** write — genesis: bring an escrow into existence. */
export interface RootWriteVerb {
  integrate(args: { asset: string; coin: CoinTag; market: Market }): Plan<{
    escrow: Escrow;
    governanceCap: GovernanceCap;
    earningsInbox: EarningsInbox;
  }>;
}

export interface Usufruct {
  /** My address (identity), or `null` when anonymous. */
  readonly address: string | null;

  // nav (zoom to a node) + the four verbs at global scope
  readonly nav: RootNavVerb;
  readonly read: RootReadVerb;
  readonly inspect: RootInspectVerb;
  readonly react: RootReactVerb;
  readonly write: RootWriteVerb;

  // entry utilities (the plumbing of the lens itself — not verbs)
  /** Wire identity + signing after construction — a held `Signer`, or an `Executor`. */
  connect(signerOrExecutor: Signer | Executor): void;
  /** Resolve a `CoinTag` for a coin type from on-chain `CoinMetadata` (cached). */
  coinType(type: string): Promise<CoinTag>;
  /** Compose several write `Plan`s into ONE atomic transaction (the tuple of results). */
  batch<T extends readonly Plan<unknown>[]>(
    ...plans: T
  ): Plan<{ -readonly [K in keyof T]: T[K] extends Plan<infer U> ? U : never }>;
  /** The core primitives (`Source` + `Reader`), untouched. */
  readonly primitives: Primitives;
}

/** Internal scaffolding — the closures the global verbs delegate to. The public
 *  handle is verbs + utilities only; these flat names are not exported. */
interface UsufructFlat {
  readonly address: string | null;
  connect(signerOrExecutor: Signer | Executor): void;
  escrow(id: string, opts?: { at?: When }): Promise<Escrow>;
  escrows(ids: string[], opts?: { at?: When }): Promise<Escrow[]>;
  watchMany(escrowIds: string[], onChange: (e: Escrow) => void, opts?: { intervalMs?: number }): PortfolioWatch;
  integrate(args: { asset: string; coin: CoinTag; market: Market }): Plan<{ escrow: Escrow; governanceCap: GovernanceCap; earningsInbox: EarningsInbox }>;
  batch<T extends readonly Plan<unknown>[]>(...plans: T): Plan<{ -readonly [K in keyof T]: T[K] extends Plan<infer U> ? U : never }>;
  usufructCap(id: string): Promise<UsufructCap>;
  governanceCap(id: string): GovernanceCap;
  earningsInbox(id: string): EarningsInbox;
  feeInbox(id?: string): Promise<ProtocolFeeInbox>;
  coinType(type: string): Promise<CoinTag>;
  escrowsIntegratedBy(integrator: string): Promise<EscrowListing[]>;
  escrowsGovernedBy(holder: string): Promise<EscrowListing[]>;
  escrowsRentedBy(holder: string): Promise<EscrowListing[]>;
  escrowsGovernedByCap(governanceCapId: string): Promise<EscrowListing[]>;
  escrowsByAssetType(assetType: string): Promise<EscrowListing[]>;
  escrowsByCoinType(coinType: string): Promise<EscrowListing[]>;
  readonly primitives: Primitives;
}

function resolveClient(config: UsufructConfig): ClientWithCoreApi {
  if (config.client) return config.client;
  const network = config.network ?? 'testnet';
  return new SuiGrpcClient({ network, baseUrl: GRPC_URL[network] });
}

/** Normalize `config.retry` to options (default on), or `null` when disabled. */
function resolveRetry(config: UsufructConfig): RetryOptions | null {
  if (config.retry === false) return null;
  return config.retry ?? {};
}


/** Construct the entry handle. */
export function usufruct(config: UsufructConfig = {}): Usufruct {
  const rawClient = resolveClient(config);
  const retry = resolveRetry(config);
  // Reads ride through transient faults (429/502/503); execution never retries.
  const client = retry ? retryingClient(rawClient, retry) : rawClient;
  const packageId = config.packageId ?? TESTNET.packageId;
  const feeRefId = config.feeRefId ?? TESTNET.feeRefId;
  // Identity (account) and signing (executor) are separate axes; `signer` is sugar
  // for both. All three are mutable via `connect`. `ctx()` resolves them live.
  let signer: Signer | null = config.signer ?? null;
  let executor: Executor | null = config.executor ?? null;
  let account: string | null = config.account ?? null;
  const resolveAccount = (): string | null =>
    account ?? executor?.address ?? signer?.toSuiAddress() ?? null;
  const resolveExecutor = (): Executor | null =>
    executor ?? (signer ? signerExecutor(client, signer) : null);

  // The core never decodes: the `Source` yields raw snapshots and the `Reader`
  // reads drift-zero (on-chain views). Decoding to a typed `EscrowState` is the
  // opt-in mirror's job (`decodeEscrowState(snapshot, schema)`). `chainSource`
  // only needs `packageId`.
  const source = chainSource(client, { packageId });

  // Discovery defaults to the network's public GraphQL endpoint (so picking a network
  // is enough); pass a URL/client to override, or `false` to disable.
  const network: Network = config.network ?? 'testnet';
  const graphqlSetting = config.graphql === false ? null : (config.graphql ?? GRAPHQL_URL[network] ?? null);
  const rawGraphql =
    graphqlSetting == null
      ? null
      : typeof graphqlSetting === 'string'
        ? new SuiGraphQLClient({ url: graphqlSetting, network })
        : graphqlSetting;
  // Discovery/history (paginated GraphQL) get the same transient-status retry.
  const graphqlClient = rawGraphql && retry ? retryingGraphqlClient(rawGraphql, retry) : rawGraphql;
  const indexer: IndexerSource | null = graphqlClient
    ? indexerSource(graphqlClient, { packageId })
    : null;

  // A gRPC client for server-push subscriptions (`escrow.watch`): reuse the
  // configured client if it's already gRPC, else stand one up from the network.
  // Derived from the raw client (push isn't a retryable request/response).
  const grpcClient: SuiGrpcClient | null =
    'subscriptionService' in (rawClient as object)
      ? (rawClient as unknown as SuiGrpcClient)
      : config.network
        ? new SuiGrpcClient({ network: config.network, baseUrl: GRPC_URL[config.network] })
        : null;

  const primitives: Primitives = {
    source,
    reader: (target) => {
      const r = createReader(client, target);
      return retry ? retryingReader(r, retry) : r;
    },
  };

  const ctx = (): HandleCtx => ({
    client,
    packageId,
    feeRefId,
    account: resolveAccount(),
    defaultExecutor: resolveExecutor(),
    ...(indexer ? { indexer } : {}),
    ...(grpcClient ? { grpcClient } : {}),
    ...(retry ? { retry } : {}),
  });

  const base: UsufructFlat = {
    get address() {
      return resolveAccount();
    },
    connect(next) {
      if (isExecutor(next)) {
        executor = next;
        account = next.address;
      } else {
        signer = next;
        executor = null; // a fresh keypair supersedes a prior executor
        account = next.toSuiAddress();
      }
    },

    escrow(idStr, opts) {
      return createEscrow(ctx(), idStr, opts?.at);
    },

    escrows(ids, opts) {
      return createEscrowMany(ctx(), ids, opts?.at);
    },

    watchMany(escrowIds, onChange, opts) {
      return watchMany(ctx(), escrowIds, onChange, opts);
    },

    integrate({ asset, coin, market }) {
      const { ensemble, retireCommitment, ensembleCommitment } = toEnsembleConfig(market);
      const coinType = coin.type;
      return makePlan({
        defaultExecutor: () => resolveExecutor(),
        // build: list the asset's type, append the integrate, keep cap + inbox.
        build: async (tx, sender) => {
          const { object } = await client.core.getObject({ objectId: asset });
          const assetType = object.type;
          const created = integrateAction({
            ensemble,
            ...(retireCommitment ? { retireCommitment } : {}),
            ...(ensembleCommitment ? { ensembleCommitment } : {}),
            assetType,
            coinType,
          })(tx, { pkg: { packageId, feeRefId }, asset, typeArguments: [assetType, coinType] });
          tx.transferObjects([created[0]!, created[1]!], sender); // [GovernanceCap, EarningsInbox]
        },
        // decode: the three created objects → resolved handles.
        decode: async (res) => {
          const escrowId = createdIdByType(res, '::escrow::Escrow');
          const capId = createdIdByType(res, '::governance_cap::GovernanceCap');
          const inboxId = createdIdByType(res, '::earnings_inbox::EarningsInbox');
          if (!escrowId || !capId || !inboxId) {
            throw new Error(`integrate: missing created object(s) (digest ${res.digest})`);
          }
          const c = ctx();
          return {
            escrow: await createEscrow(c, escrowId),
            governanceCap: createGovernanceCap(c, capId),
            earningsInbox: createInbox(c, inboxId, 'earnings'),
          };
        },
      });
    },

    batch(...plans) {
      return makePlan({
        defaultExecutor: () => resolveExecutor(),
        build: async (tx, sender) => {
          for (const p of plans) await p.build(tx, sender);
        },
        decode: async (res) =>
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (await Promise.all(plans.map((p) => p.decode(res)))) as any,
      });
    },

    async usufructCap(idStr) {
      const c = ctx();
      const { object } = await client.core.getObject({ objectId: idStr, include: { content: true } });
      const escrowId = UsufructCapBcs.parse(object.content!).escrow_identity.id;
      return createCap(c, {
        capId: idStr,
        escrowId,
        typeArguments: await fetchTypeArgs(client, escrowId),
        receipt: null,
      });
    },
    governanceCap(idStr) {
      return createGovernanceCap(ctx(), idStr);
    },
    earningsInbox(idStr) {
      return createInbox(ctx(), idStr, 'earnings');
    },
    async feeInbox(idStr) {
      const inboxId = idStr ?? (await resolveFeeInboxId(client, feeRefId));
      return createInbox(ctx(), inboxId, 'fees');
    },

    coinType(type) {
      return resolveCoinTag(client, type);
    },

    async escrowsIntegratedBy(integrator) {
      return discoverIntegrated(ctx(), { sender: integrator, integrator });
    },
    async escrowsGovernedBy(holder) {
      // Possession: the caps `holder` owns now. No `sender` filter — a cap can
      // have been transferred from its integrator, so we must scan all events.
      const ownedCaps = await ownedIds(client, holder, `${packageId}::governance_cap::GovernanceCap`);
      return discoverIntegrated(ctx(), { ownedCaps });
    },
    async escrowsGovernedByCap(governanceCapId) {
      return discoverIntegrated(ctx(), { governanceCapId });
    },
    async escrowsRentedBy(holder) {
      // The UsufructCap stores its escrow on-chain — read the caps `holder` owns
      // and decode each one's escrow id (no events needed for the cap→escrow link).
      const escrowIds = new Set<string>();
      let cursor: string | null = null;
      do {
        const page: Awaited<ReturnType<typeof client.core.listOwnedObjects>> =
          await client.core.listOwnedObjects({
            owner: holder,
            type: `${packageId}::usufruct_cap::UsufructCap`,
            cursor,
            limit: 50,
            include: { content: true },
          });
        for (const o of page.objects) {
          if (o.content) escrowIds.add(UsufructCapBcs.parse(o.content).escrow_identity.id);
        }
        cursor = page.hasNextPage ? page.cursor : null;
      } while (cursor);
      if (escrowIds.size === 0) return [];
      return discoverIntegrated(ctx(), { escrowIds });
    },
    async escrowsByAssetType(assetType) {
      return discoverIntegrated(ctx(), { assetType: normalizeStructTag(assetType) });
    },
    async escrowsByCoinType(coinType) {
      return discoverIntegrated(ctx(), { coinType: normalizeStructTag(coinType) });
    },

    primitives,
  };

  // ── the four verbs at global scope, wired over the flat methods above. The
  //    module-level constant views need no escrow, so they read through a
  //    placeholder target (the constant specs ignore escrowId / type args). ──
  const constReader = (): Reader =>
    primitives.reader({
      packageId,
      escrowId: toId<'Escrow'>('0x0'),
      typeArguments: ['0x2::sui::SUI', '0x2::sui::SUI'],
    });

  const nav: RootNavVerb = {
    escrow: base.escrow,
    escrows: base.escrows,
    usufructCap: base.usufructCap,
    governanceCap: base.governanceCap,
    earningsInbox: base.earningsInbox,
    feeInbox: base.feeInbox,
  };
  const read: RootReadVerb = {
    protocolFeeBps: () => constReader().protocolFeeBps().then(Number),
    bpsDenominator: () => constReader().bpsDenominator().then(Number),
  };
  const inspect: RootInspectVerb = {
    integratedBy: base.escrowsIntegratedBy,
    governedBy: base.escrowsGovernedBy,
    rentedBy: base.escrowsRentedBy,
    governedByCap: base.escrowsGovernedByCap,
    byAssetType: base.escrowsByAssetType,
    byCoinType: base.escrowsByCoinType,
  };
  const react: RootReactVerb = { watchMany: base.watchMany };
  const write: RootWriteVerb = { integrate: base.integrate };

  // The public handle: identity + verbs + entry utilities. The flat `base` methods
  // (escrow/integrate/…) are internal scaffolding the verbs delegate to; they do not
  // leak onto the handle. The `address` getter is redefined here to stay live.
  return {
    get address() {
      return resolveAccount();
    },
    nav,
    read,
    inspect,
    react,
    write,
    connect: base.connect,
    coinType: base.coinType,
    batch: base.batch,
    primitives,
  };
}
