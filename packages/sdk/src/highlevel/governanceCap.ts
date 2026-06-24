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

// ── the four-verb surface (additive; no nav — a govcap relates to escrows via its
//    portfolio collection → inspect, not a single edge). ──
/** read — live governance check. */
export interface GovernanceReadVerb {
  governs(escrow: EscrowRef): Promise<boolean>;
}
/** inspect — the event log / discovery (pull). */
export interface GovernanceInspectVerb {
  escrows(): Promise<EscrowListing[]>;
  revenueByEscrow(opts?: { afterCheckpoint?: number; beforeCheckpoint?: number }): Promise<EscrowRevenue[]>;
}
/** react — the event log (push), across the whole portfolio. */
export interface GovernanceReactVerb {
  watch(onChange: (e: Escrow) => void, opts?: { intervalMs?: number }): Promise<PortfolioWatch>;
}
/** write — protocol writes (Plan). */
export interface GovernanceWriteVerb {
  updateMarket(escrow: EscrowRef, changes: Partial<Market>): Plan<{ digest: string }>;
  retire(escrow: EscrowRef): Plan<{ digest: string }>;
  claim(escrow: EscrowRef, opts?: { to?: string }): Plan<{ assetId: string; digest: string }>;
  extendRetireCommitment(escrow: EscrowRef, until: Commitment): Plan<{ digest: string }>;
  extendEnsembleCommitment(escrow: EscrowRef, until: Commitment): Plan<{ digest: string }>;
  renounceGovernance(): Plan<{ digest: string }>;
  transfer(to: string): Plan<{ digest: string }>;
  integrateIntoPortfolio(asset: string, coin: CoinTag, market: Market, opts: { earningsInbox: string }): Plan<Escrow>;
}

export interface GovernanceCap {
  // identity — the object's name. All operations are verbs (no nav: a govcap relates
  // to escrows via its portfolio collection → inspect, not a single edge).
  readonly capId: string;

  readonly read: GovernanceReadVerb;
  readonly inspect: GovernanceInspectVerb;
  readonly react: GovernanceReactVerb;
  readonly write: GovernanceWriteVerb;
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

  // Internal scaffolding: the closures the verbs delegate to, typed by the verb
  // interfaces so their params keep contextual types (the public handle is verbs-only).
  const g: { capId: string } & GovernanceReadVerb &
    GovernanceInspectVerb &
    GovernanceReactVerb &
    GovernanceWriteVerb = {
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

    claim(ref, opts) {
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
          // `to` directs the unwrapped asset (default: the sender), in this same PTB.
          tx.transferObjects([asset], opts?.to ?? sender);
        },
        decode: async (res) => ({ assetId, digest: res.digest }),
      });
    },

    renounceGovernance() {
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

  const readVerb: GovernanceReadVerb = { governs: g.governs };
  const inspectVerb: GovernanceInspectVerb = { escrows: g.escrows, revenueByEscrow: g.revenueByEscrow };
  const reactVerb: GovernanceReactVerb = { watch: g.watch };
  const writeVerb: GovernanceWriteVerb = {
    updateMarket: g.updateMarket,
    retire: g.retire,
    claim: g.claim,
    extendRetireCommitment: g.extendRetireCommitment,
    extendEnsembleCommitment: g.extendEnsembleCommitment,
    renounceGovernance: g.renounceGovernance,
    transfer: g.transfer,
    integrateIntoPortfolio: g.integrateIntoPortfolio,
  };

  return { capId: g.capId, read: readVerb, inspect: inspectVerb, react: reactVerb, write: writeVerb };
}
