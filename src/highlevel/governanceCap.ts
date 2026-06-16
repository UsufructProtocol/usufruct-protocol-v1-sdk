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
import type { Signer } from '@mysten/sui/cryptography';
import { Transaction } from '@mysten/sui/transactions';
import { claimAsset } from '../actions/claimAsset.js';
import {
  extendEnsembleCommitment as extendEnsembleAction,
  extendRetireCommitment as extendRetireAction,
  renounceGovernanceToPtb,
  updateEnsemble,
} from '../actions/governance.js';
import { integrateIntoPortfolio } from '../actions/integrate.js';
import { retire as retireAction } from '../actions/retire.js';
import { type Id, id as toId } from '../primitives/brand.js';
import { createReader } from '../read/reader.js';
import { transferOf } from './bearer.js';
import { fetchTypeArgs } from './typeargs.js';
import type { HandleCtx } from './ctx.js';
import { createEscrow, type Escrow } from './escrow.js';
import { NotConnected, UsufructError, mapAbort } from './errors.js';
import { type Commitment, type Market, toCommitmentConfig, toEnsembleConfig } from './market.js';
import { discoverIntegrated, type EscrowListing } from './listings.js';
import type { CoinTag } from './value.js';
import { readMarket } from './marketReadback.js';
import { createdIdByType, execute } from './send.js';

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
  updateMarket(escrow: EscrowRef, changes: Partial<Market>): Promise<{ digest: string }>;
  retire(escrow: EscrowRef): Promise<{ digest: string }>;
  claim(escrow: EscrowRef): Promise<{ assetId: string; digest: string }>;
  extendRetireCommitment(escrow: EscrowRef, until: Commitment): Promise<{ digest: string }>;
  extendEnsembleCommitment(escrow: EscrowRef, until: Commitment): Promise<{ digest: string }>;

  // cap-level
  renounce(): Promise<{ digest: string }>;
  /** Hand governance (this cap) to another address. */
  transfer(to: string): Promise<{ digest: string }>;

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
  ): Promise<Escrow>;

  /**
   * The escrows THIS cap governs — its **portfolio**, as decode-free
   * `EscrowListing`s. The cap *is* the governor, so it answers for itself. (The
   * cap→escrow link lives only in the event log, not on the cap.) Needs `graphql`.
   */
  escrows(): Promise<EscrowListing[]>;
}

interface RefInfo {
  readonly escrowId: Id<'Escrow'>;
  readonly typeArguments: [string, string];
}

/** Build a `GovernanceCap` handle. Authority = the signer currently holding it. */
export function createGovernanceCap(ctx: HandleCtx, capId: string): GovernanceCap {
  const { client, packageId, feeRefId, signer, assetSchema } = ctx;
  const pkg = { packageId, feeRefId };
  const govId = toId<'GovernanceCap'>(capId);

  const need = (action: string): Signer => {
    if (signer == null) {
      throw new NotConnected(`${action} requires a signer; pass one to usufruct() or u.connect()`);
    }
    return signer;
  };

  async function resolveRef(ref: EscrowRef): Promise<RefInfo> {
    if (typeof ref !== 'string') {
      return { escrowId: toId<'Escrow'>(ref.id), typeArguments: [ref.assetType, ref.coinType] };
    }
    return { escrowId: toId<'Escrow'>(ref), typeArguments: await fetchTypeArgs(client, ref) };
  }

  /** Resolve the escrow, build one PTB command, sign+send. */
  async function write(
    action: string,
    ref: EscrowRef,
    build: (tx: Transaction, r: RefInfo) => void,
  ): Promise<{ digest: string }> {
    const s = need(action);
    const r = await resolveRef(ref);
    const tx = new Transaction();
    build(tx, r);
    const res = await execute(client, tx, s).catch(mapAbort);
    return { digest: res.digest };
  }

  return {
    capId,

    async updateMarket(ref, changes) {
      const s = need('updateMarket');
      const r = await resolveRef(ref);
      // Read the current market, overlay the changes, send the full ensemble.
      const reader = createReader(client, {
        packageId,
        escrowId: r.escrowId,
        typeArguments: r.typeArguments,
        ...(assetSchema ? { assetSchema } : {}),
      });
      const current = await readMarket(reader, r.typeArguments[1]);
      const { ensemble } = toEnsembleConfig({ ...current, ...changes });
      const tx = new Transaction();
      updateEnsemble(ensemble).toPtb(tx, { pkg, escrowId: r.escrowId, governanceCapId: govId, typeArguments: r.typeArguments });
      const res = await execute(client, tx, s).catch(mapAbort);
      return { digest: res.digest };
    },

    retire(ref) {
      return write('retire', ref, (tx, r) =>
        retireAction().toPtb(tx, { pkg, escrowId: r.escrowId, governanceCapId: govId, typeArguments: r.typeArguments }),
      );
    },

    extendRetireCommitment(ref, until) {
      return write('extendRetireCommitment', ref, (tx, r) =>
        extendRetireAction(toCommitmentConfig(until)).toPtb(tx, { pkg, escrowId: r.escrowId, governanceCapId: govId, typeArguments: r.typeArguments }),
      );
    },

    extendEnsembleCommitment(ref, until) {
      return write('extendEnsembleCommitment', ref, (tx, r) =>
        extendEnsembleAction(toCommitmentConfig(until)).toPtb(tx, { pkg, escrowId: r.escrowId, governanceCapId: govId, typeArguments: r.typeArguments }),
      );
    },

    async claim(ref) {
      const s = need('claim');
      const r = await resolveRef(ref);
      // A claimed asset is *unwrapped* (not "Created" in effects), so read its
      // id from the escrow's view before consuming the escrow.
      const reader = createReader(client, {
        packageId,
        escrowId: r.escrowId,
        typeArguments: r.typeArguments,
        ...(assetSchema ? { assetSchema } : {}),
      });
      const assetId = await reader.assetId();
      const tx = new Transaction();
      const asset = claimAsset().toPtb(tx, { pkg, escrowId: r.escrowId, governanceCapId: govId, typeArguments: r.typeArguments });
      tx.transferObjects([asset], s.toSuiAddress());
      const res = await execute(client, tx, s).catch(mapAbort);
      return { assetId: String(assetId), digest: res.digest };
    },

    async renounce() {
      const s = need('renounce');
      const tx = new Transaction();
      renounceGovernanceToPtb(tx, { pkg, governanceCapId: capId });
      const res = await execute(client, tx, s).catch(mapAbort);
      return { digest: res.digest };
    },

    transfer: transferOf(ctx, capId, 'governanceCap'),

    async integrateIntoPortfolio(asset, coin, market, opts) {
      const s = need('integrateIntoPortfolio');
      const { ensemble, retireCommitment, ensembleCommitment } = toEnsembleConfig(market);
      const coinType = coin.type;
      const { object } = await client.core.getObject({ objectId: asset });
      const assetType = object.type;
      const tx = new Transaction();
      integrateIntoPortfolio({
        ensemble,
        ...(retireCommitment ? { retireCommitment } : {}),
        ...(ensembleCommitment ? { ensembleCommitment } : {}),
        assetType,
        coinType,
      }).toPtb(tx, {
        pkg,
        asset,
        typeArguments: [assetType, coinType],
        governanceCapId: capId,
        earningsInboxId: opts.earningsInbox,
      });
      const res = await execute(client, tx, s).catch(mapAbort);
      const escrowId = createdIdByType(res, '::escrow::Escrow');
      if (escrowId == null) throw new UsufructError(`integrateIntoPortfolio: no Escrow created (digest ${res.digest})`);
      return createEscrow(ctx, escrowId);
    },

    escrows() {
      return discoverIntegrated(ctx, { governanceCapId: capId });
    },
  };
}
