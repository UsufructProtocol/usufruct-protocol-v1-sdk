/**
 * The `Governor` handle (Layer 2) — the supply side. Wraps the `GovernanceCap`
 * and its `EarningsInbox`. One cap governs a *portfolio*, so the per-escrow
 * writes name their target `escrow` (the Move fns take `escrow` AND
 * `&GovernanceCap`); `earnings`/`renounce`/`list` are cap/portfolio level.
 */
import type { Signer } from '@mysten/sui/cryptography';
import { Transaction } from '@mysten/sui/transactions';
import { claimAsset } from '../actions/claimAsset.js';
import { collectMessages, discoverInboxMessages, type MessageGroups } from '../actions/collect.js';
import {
  extendEnsembleCommitment as extendEnsembleAction,
  extendRetireCommitment as extendRetireAction,
  renounceGovernanceToPtb,
  updateEnsemble,
} from '../actions/governance.js';
import { integrateIntoPortfolio } from '../actions/integrate.js';
import { retire as retireAction } from '../actions/retire.js';
import { type Id, id as toId } from '../primitives/brand.js';
import type { HandleCtx } from './ctx.js';
import { createEscrow, type Escrow } from './escrow.js';
import { NotConnected, UsufructError, mapAbort } from './errors.js';
import { type Commitment, type Market, toCommitmentConfig, toEnsembleConfig } from './market.js';
import { createdIdByType, execute } from './send.js';
import { coinInfo, price, type Price } from './value.js';

/** An escrow id, or a resolved `Escrow` handle. */
export type EscrowRef = string | Escrow;

/** The governor's owned `EarningsInbox` (income, separate from governance). */
export interface Earnings {
  readonly inboxId: string;
  /** Preview pending income per coin (no collect). */
  balance(): Promise<Array<{ coin: string; amount: Price }>>;
  /** Collect the whole portfolio's income, partitioned by coin (§5.2). */
  collect(): Promise<Array<{ coin: string; amount: Price }>>;
}

export interface Governor {
  readonly capId: string;
  readonly earnings: Earnings;

  // per-escrow governance (the target escrow is required — one cap, many escrows)
  update(escrow: EscrowRef, market: Market): Promise<{ digest: string }>;
  retire(escrow: EscrowRef): Promise<{ digest: string }>;
  claim(escrow: EscrowRef): Promise<{ assetId: string; digest: string }>;
  extendRetireCommitment(escrow: EscrowRef, until: Commitment): Promise<{ digest: string }>;
  extendEnsembleCommitment(escrow: EscrowRef, until: Commitment): Promise<{ digest: string }>;

  // cap-level
  renounce(): Promise<{ digest: string }>;

  // portfolio
  list(asset: string, market: Market): Promise<Escrow>;
  escrows(): Promise<Escrow[]>;
}

interface RefInfo {
  readonly escrowId: Id<'Escrow'>;
  readonly typeArguments: [string, string];
  readonly assetType: string;
}

function sumGroups(groups: MessageGroups): Array<{ coin: string; amount: Price }> {
  return [...groups].map(([coin, refs]) => ({
    coin,
    amount: price(refs.reduce((a, r) => a + r.amountMist, 0n), coinInfo(coin)),
  }));
}

/** `'0x..::module::Type'` → `'::module::Type'` (effect-type fragment). */
function typeFrag(t: string): string {
  return `::${t.split('::').slice(1).join('::')}`;
}

/** Build a `Governor` handle bound to its GovernanceCap + EarningsInbox. */
export function createGovernor(ctx: HandleCtx, opts: { capId: string; inboxId: string }): Governor {
  const { client, packageId, feeRefId, source, signer } = ctx;
  const capId = opts.capId;
  const pkg = { packageId, feeRefId };

  const need = (action: string): Signer => {
    if (signer == null) {
      throw new NotConnected(`${action} requires a signer; pass one to usufruct() or u.connect()`);
    }
    return signer;
  };

  async function resolveRef(ref: EscrowRef): Promise<RefInfo> {
    if (typeof ref !== 'string') {
      return { escrowId: toId<'Escrow'>(ref.id), typeArguments: [ref.assetType, ref.coinType], assetType: ref.assetType };
    }
    const state = await source.fetch(toId<'Escrow'>(ref));
    return { escrowId: toId<'Escrow'>(ref), typeArguments: [state.assetType, state.coinType], assetType: state.assetType };
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

  const earnings: Earnings = {
    inboxId: opts.inboxId,
    async balance() {
      return sumGroups(await discoverInboxMessages(client, opts.inboxId, 'earnings'));
    },
    async collect() {
      const s = need('earnings.collect');
      const groups = await discoverInboxMessages(client, opts.inboxId, 'earnings');
      if (groups.size === 0) return [];
      const tx = new Transaction();
      const coins = collectMessages({ kind: 'earnings', groups }).toPtb(tx, { pkg, inboxId: opts.inboxId });
      tx.transferObjects(coins, s.toSuiAddress());
      await execute(client, tx, s).catch(mapAbort);
      return sumGroups(groups);
    },
  };

  return {
    capId,
    earnings,

    update(ref, market) {
      const { ensemble } = toEnsembleConfig(market);
      return write('update', ref, (tx, r) =>
        updateEnsemble(ensemble).toPtb(tx, {
          pkg,
          escrowId: r.escrowId,
          governanceCapId: toId<'GovernanceCap'>(capId),
          typeArguments: r.typeArguments,
        }),
      );
    },

    retire(ref) {
      return write('retire', ref, (tx, r) =>
        retireAction().toPtb(tx, {
          pkg,
          escrowId: r.escrowId,
          governanceCapId: toId<'GovernanceCap'>(capId),
          typeArguments: r.typeArguments,
        }),
      );
    },

    extendRetireCommitment(ref, until) {
      return write('extendRetireCommitment', ref, (tx, r) =>
        extendRetireAction(toCommitmentConfig(until)).toPtb(tx, {
          pkg,
          escrowId: r.escrowId,
          governanceCapId: toId<'GovernanceCap'>(capId),
          typeArguments: r.typeArguments,
        }),
      );
    },

    extendEnsembleCommitment(ref, until) {
      return write('extendEnsembleCommitment', ref, (tx, r) =>
        extendEnsembleAction(toCommitmentConfig(until)).toPtb(tx, {
          pkg,
          escrowId: r.escrowId,
          governanceCapId: toId<'GovernanceCap'>(capId),
          typeArguments: r.typeArguments,
        }),
      );
    },

    async claim(ref) {
      const s = need('claim');
      const r = await resolveRef(ref);
      const tx = new Transaction();
      const asset = claimAsset().toPtb(tx, {
        pkg,
        escrowId: r.escrowId,
        governanceCapId: toId<'GovernanceCap'>(capId),
        typeArguments: r.typeArguments,
      });
      tx.transferObjects([asset], s.toSuiAddress());
      const res = await execute(client, tx, s).catch(mapAbort);
      return { assetId: createdIdByType(res, typeFrag(r.assetType)) ?? '', digest: res.digest };
    },

    async renounce() {
      const s = need('renounce');
      const tx = new Transaction();
      renounceGovernanceToPtb(tx, { pkg, governanceCapId: capId });
      const res = await execute(client, tx, s).catch(mapAbort);
      return { digest: res.digest };
    },

    async list(asset, market) {
      const s = need('list');
      const { ensemble, retireCommitment, ensembleCommitment } = toEnsembleConfig(market);
      const coinType = market.coin.type;
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
        pkg: { packageId, feeRefId },
        asset,
        typeArguments: [assetType, coinType],
        governanceCapId: capId,
        earningsInboxId: opts.inboxId,
      });
      const res = await execute(client, tx, s).catch(mapAbort);
      const escrowId = createdIdByType(res, '::escrow::Escrow');
      if (escrowId == null) throw new UsufructError(`list: no Escrow created (digest ${res.digest})`);
      return createEscrow(ctx, escrowId);
    },

    async escrows() {
      const owner = signer?.toSuiAddress() ?? null;
      if (ctx.indexer == null || owner == null) {
        throw new UsufructError('escrows() needs GraphQL discovery and a signer; pass { graphql, signer } to usufruct()');
      }
      const out: Escrow[] = [];
      for await (const state of ctx.indexer.query({ byGovernor: owner })) {
        out.push(await createEscrow(ctx, state.objectId));
      }
      return out;
    },
  };
}
