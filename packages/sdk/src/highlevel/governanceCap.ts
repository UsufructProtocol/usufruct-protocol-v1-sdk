/**
 * The `GovernanceCap` handle (Layer 2) — a bearer capability object. Holding it
 * makes you the governor of the escrows it governs (NOT necessarily the address
 * that integrated). One cap governs a *portfolio*, so the per-escrow writes name
 * their target `escrow` (the Move fns take `escrow` AND `&GovernanceCap`).
 *
 * Earnings are a *separate* object (`EarningsInbox`) — not bundled here. When
 * listing into the portfolio you name the inbox the new escrow pays into,
 * because the two are independently transferable.
 */
import { Transaction } from '@mysten/sui/transactions';
import { claimAssetToPtb } from '../actions/claimAsset.js';
import {
  extendEnsembleCommitmentToPtb as extendEnsembleAction,
  extendRetireCommitmentToPtb as extendRetireAction,
  renounceGovernanceToPtb,
  updateEnsembleToPtb,
} from '../actions/governance.js';
import { integrateIntoPortfolioToPtb } from '../actions/integrate.js';
import { retireToPtb as retireAction } from '../actions/retire.js';
import { type Id, id as toId } from '../primitives/brand.js';
import { createReader } from '../read/reader.js';
import { transferOf } from './bearer.js';
import { fetchTypeArgs } from './typeargs.js';
import type { HandleCtx } from './ctx.js';
import { createEscrow, type Escrow } from './escrow.js';
import { digestPlan, makePlan, type Plan } from './plan.js';
import { UsufructError } from './errors.js';
import { type Commitment, type Market, toCommitmentConfig, toEnsembleConfig } from './market.js';
import { discoverIntegrated, type EscrowListing } from './listings.js';
import { watchMany, type PortfolioWatch } from './watch-many.js';
import { coinInfo, coinTag, price, type CoinTag } from './value.js';
import { resolveCoinInfo } from './coinmeta.js';
import { type EscrowRevenue } from './ledger.js';
import { readMarket } from './marketReadback.js';
import { createdIdByType } from './send.js';

/** An escrow id, or a resolved `Escrow` handle. */
export type EscrowRef = string | Escrow;

export interface GovernanceCap {
  readonly capId: string;

  // per-escrow governance (the target escrow is required — one cap, many escrows)
  /**
   * Change the market. Takes a `Partial<Market>` — only the fields you change;
   * the rest are read from the current on-chain market and preserved. (You
   * reasoned about every field at `integrate`; modifying touches a subset.)
   */
  updateMarket(escrow: EscrowRef, changes: Partial<Market>): Plan<{ digest: string }>;
  retire(escrow: EscrowRef): Plan<{ digest: string }>;
  claim(escrow: EscrowRef): Plan<{ assetId: string; digest: string }>;
  extendRetireCommitment(escrow: EscrowRef, until: Commitment): Plan<{ digest: string }>;
  extendEnsembleCommitment(escrow: EscrowRef, until: Commitment): Plan<{ digest: string }>;

  // cap-level
  renounce(): Plan<{ digest: string }>;
  /** Hand governance (this cap) to another address. */
  transfer(to: string): Plan<{ digest: string }>;

  /**
   * Integrate a NEW asset (priced in `coin`) into this cap's portfolio. The only
   * write that depends on TWO objects: this `GovernanceCap` (the portfolio it
   * joins) and the `earningsInbox` it will pay into — so both are named
   * explicitly. `coin` is the new escrow's immutable `phantom CoinType` (a
   * portfolio may hold escrows of different coins, all paying one inbox). Mirrors
   * the Move `integrate_into_portfolio`.
   */
  integrateIntoPortfolio(
    asset: string,
    coin: CoinTag,
    market: Market,
    opts: { earningsInbox: string },
  ): Plan<Escrow>;

  /**
   * The escrows THIS cap governs — its **portfolio**, as decode-free
   * `EscrowListing`s. The cap *is* the governor, so it answers for itself. (The
   * cap→escrow link lives only in the event log, not on the cap.) Needs `graphql`.
   */
  escrows(): Promise<EscrowListing[]>;

  /**
   * Lifetime revenue attributed **per escrow** — the other axis to the inbox's
   * `totals()` (which sums per coin). Scans `EarningsMessagePosted` and keeps the
   * messages whose `escrow_id` is in this cap's portfolio, grouping the governor's
   * take by escrow, then by coin. Answers "which of my listings earns most?".
   * Reconstructed drift-zero from events. Needs `graphql`.
   */
  revenueByEscrow(opts?: { afterCheckpoint?: number; beforeCheckpoint?: number }): Promise<EscrowRevenue[]>;

  /**
   * Does THIS cap govern the given escrow right now? Object-centric read: one cap
   * governs a *portfolio*, so the question names the escrow. (`governanceCapIsValid`
   * on that escrow, probed with this cap's id.)
   */
  governs(escrow: EscrowRef): Promise<boolean>;

  /**
   * React to changes across this cap's **whole portfolio** over one gRPC
   * firehose: resolves `escrows()` and `watchMany`s them. `onChange` fires with a
   * handle per escrow's current state, then on every change. Grow/shrink and end
   * via the returned `PortfolioWatch`. Needs `graphql` (for the portfolio
   * discovery); the watch itself is gRPC-push, polling-fallback.
   */
  watch(
    onChange: (e: Escrow) => void,
    opts?: { intervalMs?: number },
  ): Promise<PortfolioWatch>;
}

interface RefInfo {
  readonly escrowId: Id<'Escrow'>;
  readonly typeArguments: [string, string];
}

/** Build a `GovernanceCap` handle. Authority = the signer currently holding it. */
export function createGovernanceCap(ctx: HandleCtx, capId: string): GovernanceCap {
  const { client, packageId, feeRefId } = ctx;
  const pkg = { packageId, feeRefId };
  const govId = toId<'GovernanceCap'>(capId);

  async function resolveRef(ref: EscrowRef): Promise<RefInfo> {
    if (typeof ref !== 'string') {
      return { escrowId: toId<'Escrow'>(ref.id), typeArguments: [ref.assetType, ref.coinType] };
    }
    return { escrowId: toId<'Escrow'>(ref), typeArguments: await fetchTypeArgs(client, ref) };
  }

  /** A digest-only governance write: resolve the escrow, append one PTB command. */
  function write(
    ref: EscrowRef,
    build: (tx: Transaction, r: RefInfo) => void,
  ): Plan<{ digest: string }> {
    return digestPlan(
      () => ctx.defaultExecutor,
      async (tx) => {
        build(tx, await resolveRef(ref));
      },
    );
  }

  return {
    capId,

    updateMarket(ref, changes) {
      return digestPlan(
        () => ctx.defaultExecutor,
        async (tx) => {
          const r = await resolveRef(ref);
          // Read the current market, overlay the changes, send the full ensemble.
          const reader = createReader(client, {
            packageId,
            escrowId: r.escrowId,
            typeArguments: r.typeArguments,
          });
          // Decimals are irrelevant to the merge (only mist is sent), so the fallback coin tag is fine.
          const current = await readMarket(reader, coinTag(coinInfo(r.typeArguments[1])));
          const { ensemble } = toEnsembleConfig({ ...current, ...changes });
          updateEnsembleToPtb(ensemble)(tx, { pkg, escrowId: r.escrowId, governanceCapId: govId, typeArguments: r.typeArguments });
        },
      );
    },

    retire(ref) {
      return write(ref, (tx, r) =>
        retireAction()(tx, { pkg, escrowId: r.escrowId, governanceCapId: govId, typeArguments: r.typeArguments }),
      );
    },

    extendRetireCommitment(ref, until) {
      return write(ref, (tx, r) =>
        extendRetireAction(toCommitmentConfig(until))(tx, { pkg, escrowId: r.escrowId, governanceCapId: govId, typeArguments: r.typeArguments }),
      );
    },

    extendEnsembleCommitment(ref, until) {
      return write(ref, (tx, r) =>
        extendEnsembleAction(toCommitmentConfig(until))(tx, { pkg, escrowId: r.escrowId, governanceCapId: govId, typeArguments: r.typeArguments }),
      );
    },

    claim(ref) {
      // A claimed asset is *unwrapped* (not "Created" in effects), so its id is
      // read from the escrow's view at build time and carried into decode.
      let assetId = '';
      return makePlan({
        defaultExecutor: () => ctx.defaultExecutor,
        build: async (tx, sender) => {
          const r = await resolveRef(ref);
          const reader = createReader(client, {
            packageId,
            escrowId: r.escrowId,
            typeArguments: r.typeArguments,
          });
          assetId = String(await reader.assetId());
          const asset = claimAssetToPtb()(tx, { pkg, escrowId: r.escrowId, governanceCapId: govId, typeArguments: r.typeArguments });
          tx.transferObjects([asset], sender);
        },
        decode: async (res) => ({ assetId, digest: res.digest }),
      });
    },

    renounce() {
      return digestPlan(
        () => ctx.defaultExecutor,
        (tx) => renounceGovernanceToPtb(tx, { pkg, governanceCapId: capId }),
      );
    },

    transfer: transferOf(ctx, capId),

    integrateIntoPortfolio(asset, coin, market, opts) {
      const { ensemble, retireCommitment, ensembleCommitment } = toEnsembleConfig(market);
      const coinType = coin.type;
      return makePlan({
        defaultExecutor: () => ctx.defaultExecutor,
        build: async (tx) => {
          const { object } = await client.core.getObject({ objectId: asset });
          const assetType = object.type;
          integrateIntoPortfolioToPtb({
            ensemble,
            ...(retireCommitment ? { retireCommitment } : {}),
            ...(ensembleCommitment ? { ensembleCommitment } : {}),
            assetType,
            coinType,
          })(tx, {
            pkg,
            asset,
            typeArguments: [assetType, coinType],
            governanceCapId: capId,
            earningsInboxId: opts.earningsInbox,
          });
        },
        decode: async (res) => {
          const escrowId = createdIdByType(res, '::escrow::Escrow');
          if (escrowId == null) throw new UsufructError(`integrateIntoPortfolio: no Escrow created (digest ${res.digest})`);
          return createEscrow(ctx, escrowId);
        },
      });
    },

    escrows() {
      return discoverIntegrated(ctx, { governanceCapId: capId });
    },

    async revenueByEscrow(revOpts) {
      if (ctx.indexer == null) {
        throw new UsufructError('revenueByEscrow requires a GraphQL endpoint — pass `graphql` to usufruct()');
      }
      const norm = (v: unknown) => String(v ?? '').replace(/^0x/, '').toLowerCase();
      const listings = await discoverIntegrated(ctx, { governanceCapId: capId });
      const want = new Set(listings.map((l) => norm(l.escrowId)));
      const idForm = new Map(listings.map((l) => [norm(l.escrowId), l.escrowId]));
      // escrow (norm) → coin → { mist, count } — one scan, filtered to this portfolio.
      const byEscrow = new Map<string, Map<string, { mist: bigint; count: number }>>();
      for await (const ev of ctx.indexer.events({
        type: `${packageId}::earnings_message::EarningsMessagePosted`,
        ...(revOpts?.afterCheckpoint !== undefined ? { afterCheckpoint: revOpts.afterCheckpoint } : {}),
        ...(revOpts?.beforeCheckpoint !== undefined ? { beforeCheckpoint: revOpts.beforeCheckpoint } : {}),
      })) {
        const eid = norm(ev.data['escrow_id'] ?? ev.escrowId);
        if (!want.has(eid)) continue;
        const coin = String(ev.data['coin_type'] ?? '');
        const coins = byEscrow.get(eid) ?? new Map<string, { mist: bigint; count: number }>();
        const cur = coins.get(coin) ?? { mist: 0n, count: 0 };
        coins.set(coin, { mist: cur.mist + BigInt(String(ev.data['amount'] ?? '0')), count: cur.count + 1 });
        byEscrow.set(eid, coins);
      }
      return Promise.all(
        [...byEscrow.entries()].map(async ([eid, coins]) => ({
          escrowId: idForm.get(eid) ?? eid,
          earnings: await Promise.all(
            [...coins.entries()].map(async ([coin, { mist, count }]) => ({
              coin,
              total: price(mist, await resolveCoinInfo(client, coin)),
              count,
            })),
          ),
        })),
      );
    },

    async governs(ref) {
      const r = await resolveRef(ref);
      return createReader(client, {
        packageId,
        escrowId: r.escrowId,
        typeArguments: r.typeArguments,
      }).governanceCapIsValid(capId);
    },

    async watch(onChange, watchOpts) {
      const listings = await discoverIntegrated(ctx, { governanceCapId: capId });
      const ids = listings.map((l) => l.escrowId);
      return watchMany(ctx, ids, onChange, watchOpts);
    },
  };
}
