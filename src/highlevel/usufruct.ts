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
import { Transaction } from '@mysten/sui/transactions';
import { integrate as integrateAction } from '../actions/integrate.js';
import { UsufructCap as UsufructCapBcs } from '../codegen/usufruct/usufruct_cap.js';
import { TESTNET } from '../config/network.js';
import { indexerSource, type IndexerSource } from '../indexer/index.js';
import { fetchTypeArgs } from './typeargs.js';
import { chainSource, type Source } from '../primitives/source.js';
import type { AssetSchema } from '../primitives/state.js';
import { createReader, type Reader, type ReaderTarget } from '../read/reader.js';
import { createCap, type UsufructCap } from './cap.js';
import type { HandleCtx } from './ctx.js';
import { createEscrow, type Escrow } from './escrow.js';
import { createGovernanceCap, type GovernanceCap } from './governanceCap.js';
import { createInbox, type EarningsInbox, type ProtocolFeeInbox } from './inbox.js';
import { resolveFeeInboxId } from './feeref.js';
import { normalizeStructTag } from '@mysten/sui/utils';
import { resolveCoinTag } from './coinmeta.js';
import { discoverIntegrated, type EscrowListing } from './listings.js';
import { ownedIds } from './role.js';
import { NotConnected, mapAbort } from './errors.js';
import { type Market, toEnsembleConfig } from './market.js';
import { createdIdByType, execute } from './send.js';
import type { CoinTag } from './value.js';

export type Network = 'testnet' | 'mainnet' | 'devnet' | 'localnet';

/** Explicit time. Defaults to the fetched chain clock (never the local clock). */
export type When = Date | number | 'now';

const GRPC_URL: Record<Network, string> = {
  testnet: 'https://fullnode.testnet.sui.io:443',
  mainnet: 'https://fullnode.mainnet.sui.io:443',
  devnet: 'https://fullnode.devnet.sui.io:443',
  localnet: 'http://127.0.0.1:9000',
};

export interface UsufructConfig {
  /** Pick a known network (builds a gRPC client). Default `'testnet'`. */
  readonly network?: Network;
  /** Bring your own transport (gRPC / JSON-RPC). Overrides `network`. */
  readonly client?: ClientWithCoreApi;
  /** Required only for writes; reads need none. */
  readonly signer?: Signer;
  /** Defaults to the network's deployed package id. */
  readonly packageId?: string;
  /** The frozen `ProtocolFeeRef` consumed by `integrate`; defaults to the network's. */
  readonly feeRefId?: string;
  /** Asset BCS schema for non-uid assets (SPEC §10); defaults to uid-only. */
  readonly assetSchema?: AssetSchema;
  /** GraphQL endpoint (URL or client) — enables discovery (`governor.escrows()`). */
  readonly graphql?: string | SuiGraphQLClient;
}

/** The raw kernel, one property away (escape hatch — SPEC rule #2). */
export interface Primitives {
  readonly source: Source;
  /** Build a drift-free `Reader` for an escrow target (needs its type args). */
  reader(target: ReaderTarget): Reader;
}

export interface Usufruct {
  /** The signer's address, or `null` when read-only. */
  readonly address: string | null;
  /** Wire a wallet/keypair after construction (wallet-standard adapter). */
  connect(signer: Signer): void;

  /** Door: resolve an escrow's state + the signer's role here (one fetch). */
  escrow(id: string, opts?: { at?: When }): Promise<Escrow>;

  /**
   * Genesis: wrap an owned `asset` into a rental market priced in `coin`. Mints
   * three *independent* bearer objects (escrow + governance cap + earnings inbox)
   * — returned as separate handles, all initially yours, transferable apart.
   *
   * `coin` is the immutable `phantom CoinType` of the escrow — fixed here, never
   * changeable (it's not part of the mutable `Market`).
   */
  integrate(args: { asset: string; coin: CoinTag; market: Market }): Promise<{
    escrow: Escrow;
    governanceCap: GovernanceCap;
    earningsInbox: EarningsInbox;
  }>;

  // ── object doors: a handle to a capability object by id (authority = holding it) ──
  /** The `UsufructCap` (its escrow resolved from the object). */
  usufructCap(id: string): Promise<UsufructCap>;
  /** The `GovernanceCap`. */
  governanceCap(id: string): GovernanceCap;
  /** An `EarningsInbox`. */
  earningsInbox(id: string): EarningsInbox;
  /**
   * The deployer's `ProtocolFeeInbox`. With no id, resolves the deployment
   * singleton from the configured `ProtocolFeeRef` (the inbox is one object per
   * deployment, pinned by the frozen ref) — so the holder just calls
   * `u.feeInbox()` without hunting an id off an escrow.
   */
  feeInbox(id?: string): Promise<ProtocolFeeInbox>;

  /**
   * Resolve a `CoinTag` for a coin type, reading its decimals/symbol from the
   * on-chain `CoinMetadata` (cached). Saves the dev from hardcoding them — and
   * keeps the SDK coin-agnostic (no assumed 9 decimals). `await u.coinType(t)`.
   */
  coinType(type: string): Promise<CoinTag>;

  // ── discovery: find escrows by relationship, via the indexer's typed events ──
  /**
   * The escrows `integrator` *integrated* — read from `AssetIntegrated` events as
   * decode-free `EscrowListing`s. This is who brought the escrow into being, NOT
   * who governs it now: governance is **object-centric** — the holder of the
   * `GovernanceCap` governs, and that cap can be transferred. Each listing
   * carries `governanceCapId`; to know if *you* govern, check the handle
   * (`(await listing.escrow()).canGovern`). Requires a `graphql` endpoint.
   */
  escrowsIntegratedBy(integrator: string): Promise<EscrowListing[]>;
  /**
   * The escrows `holder` **governs right now** — object-centric, by possession.
   * The `GovernanceCap` does NOT store which escrows it governs (that link lives
   * only in the `AssetIntegrated` event log), so this lists `holder`'s owned
   * `GovernanceCap`s and intersects them with the event log. Unlike
   * `escrowsIntegratedBy`, it follows the cap: it includes escrows whose cap was
   * transferred TO `holder`, and excludes ones whose cap they gave away. One cap
   * can govern many escrows (a portfolio) — all are returned. Needs `graphql`.
   */
  escrowsGovernedBy(holder: string): Promise<EscrowListing[]>;
  /**
   * The escrows `holder` **rents** right now — object-centric, by possession. The
   * `UsufructCap` *stores* its escrow on-chain (`escrow_identity`), so this reads
   * `holder`'s owned caps directly (no events for the cap→escrow link) and enriches
   * to `EscrowListing`s from the event log. Needs `graphql`.
   */
  escrowsRentedBy(holder: string): Promise<EscrowListing[]>;
  /**
   * The escrows a specific `GovernanceCap` governs — its **portfolio**, keyed on
   * the cap object itself (the purest object-centric query: the cap *is* the
   * governor). `escrowsGovernedBy(addr)` is the union of this over `addr`'s owned
   * caps. Needs `graphql`. (Also on the handle: `governanceCap.escrows()`.)
   */
  escrowsGovernedByCap(governanceCapId: string): Promise<EscrowListing[]>;
  /** The escrows of a given asset Move type, as decode-free `EscrowListing`s. */
  escrowsByAssetType(assetType: string): Promise<EscrowListing[]>;

  /** The four primitives, untouched. */
  readonly primitives: Primitives;
}

function resolveClient(config: UsufructConfig): ClientWithCoreApi {
  if (config.client) return config.client;
  const network = config.network ?? 'testnet';
  return new SuiGrpcClient({ network, baseUrl: GRPC_URL[network] });
}


/** Construct the entry handle. */
export function usufruct(config: UsufructConfig = {}): Usufruct {
  const client = resolveClient(config);
  const packageId = config.packageId ?? TESTNET.packageId;
  const feeRefId = config.feeRefId ?? TESTNET.feeRefId;
  const assetSchema = config.assetSchema;
  let signer: Signer | null = config.signer ?? null;

  const source = chainSource(client, { packageId, ...(assetSchema ? { assetSchema } : {}) });

  const graphqlClient =
    config.graphql == null
      ? null
      : typeof config.graphql === 'string'
        ? new SuiGraphQLClient({ url: config.graphql, network: config.network ?? 'testnet' })
        : config.graphql;
  const indexer: IndexerSource | null = graphqlClient
    ? indexerSource(graphqlClient, { packageId, ...(assetSchema ? { assetSchema } : {}) })
    : null;

  const primitives: Primitives = {
    source,
    reader: (target) => createReader(client, target),
  };

  const ctx = (): HandleCtx => ({
    client,
    packageId,
    feeRefId,
    signer,
    ...(assetSchema ? { assetSchema } : {}),
    ...(indexer ? { indexer } : {}),
  });

  return {
    get address() {
      return signer?.toSuiAddress() ?? null;
    },
    connect(next) {
      signer = next;
    },

    escrow(idStr, opts) {
      return createEscrow(ctx(), idStr, opts?.at);
    },

    async integrate({ asset, coin, market }) {
      const s = signer;
      if (s == null) throw new NotConnected('integrate requires a signer; pass one to usufruct() or u.connect()');
      const { ensemble, retireCommitment, ensembleCommitment } = toEnsembleConfig(market);
      const coinType = coin.type;
      const { object } = await client.core.getObject({ objectId: asset });
      const assetType = object.type;

      const tx = new Transaction();
      const created = integrateAction({
        ensemble,
        ...(retireCommitment ? { retireCommitment } : {}),
        ...(ensembleCommitment ? { ensembleCommitment } : {}),
        assetType,
        coinType,
      }).toPtb(tx, { pkg: { packageId, feeRefId }, asset, typeArguments: [assetType, coinType] });
      tx.transferObjects([created[0]!, created[1]!], s.toSuiAddress()); // [GovernanceCap, EarningsInbox]

      const res = await execute(client, tx, s).catch(mapAbort);
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

    primitives,
  };
}
