/**
 * The `Escrow` handle (Layer 2) — the hub: one batched read snapshot, the
 * signer's resolved role, and (Phase C) the permissionless writes.
 *
 * One `await` (`u.escrow(id)`) resolves state, the curated read getters at a
 * single time `t`, *and* the signer's role here — so everything below is sync.
 * The reads are a snapshot at `t` (the fetch time); for live values use the
 * kernel `reader` (exposed) or, later, `watch`/`priceCurve`.
 */
import { Transaction } from '@mysten/sui/transactions';
import { id as toId, mist, tenureCount } from '../primitives/brand.js';
import { createReader, type Reader } from '../read/reader.js';
import { rent as rentAction } from '../actions/rent.js';
import { createCap, type UsufructCap } from './cap.js';
import { type Payment, resolvePayment } from './coins.js';
import type { HandleCtx } from './ctx.js';
import { createGovernanceCap, type GovernanceCap } from './governanceCap.js';
import { createInbox, type EarningsInbox } from './inbox.js';
import { NotConnected, mapAbort } from './errors.js';
import { createdIdByType, execute } from './send.js';
import { coinInfo, price, type Price } from './value.js';
import { resolveWhen } from './clock.js';
import { resolveRole } from './role.js';
import type { When } from './usufruct.js';

export type EscrowStatus = 'idle' | 'descent' | 'occupied' | 'demand' | 'retired';

/** The hub handle. Reads are sync getters off one fetch; writes return handles. */
export interface Escrow {
  readonly id: string;
  readonly assetType: string;
  readonly coinType: string;

  // reads — a snapshot at the fetch time `t`
  readonly status: EscrowStatus;
  /** Free to take now at the floor (idle/descent), without displacing a tenant. */
  readonly isAvailable: boolean;
  readonly floorPrice: Price;
  readonly accruedCredit: Price;
  readonly expiresAt: Date | null;

  // identities — which objects relate to this escrow (data, any holder)
  readonly governanceCapId: string;
  readonly earningsInboxId: string;
  readonly feeInboxId: string;
  readonly activeUsufructCapId: string | null;

  // the signer's holdings here, resolved in the same fetch (possession = role)
  readonly canRent: boolean;
  readonly canBorrow: boolean;
  readonly canGovern: boolean;
  /** The active `UsufructCap`, if the signer holds it (sync). */
  readonly cap: UsufructCap | null;
  /** The `GovernanceCap`, if the signer holds it (sync). */
  readonly governanceCap: GovernanceCap | null;
  /** The `EarningsInbox`, if the signer holds it (sync). */
  readonly earnings: EarningsInbox | null;

  /**
   * Acquire the right of use for `tenures`. `payment` is required (a real
   * `Coin<C>` arg): pass a coin you control, or an opt-in sourcer
   * (`u.fromBalance(C)` / `u.coin(C, amount)`). Returns the minted `UsufructCap`.
   */
  rent(args: { tenures: number; payment: Payment }): Promise<UsufructCap>;

  /** Escape hatch: the drift-free kernel reader for this escrow (all ~80 views). */
  readonly reader: Reader;
}

async function resolveStatus(reader: Reader): Promise<EscrowStatus> {
  const [retired, occupied, demand, descending] = await Promise.all([
    reader.isRetired(),
    reader.isOccupied(),
    reader.isDemand(),
    reader.isDescending(),
  ]);
  if (retired) return 'retired';
  if (occupied) return 'occupied';
  if (demand) return 'demand';
  if (descending) return 'descent';
  return 'idle';
}

/** Build an `Escrow` handle: fetch state + read getters at `t` + role, all batched. */
export async function createEscrow(ctx: HandleCtx, idStr: string, at?: When): Promise<Escrow> {
  const { client, packageId, source, signer, assetSchema } = ctx;
  const owner = signer?.toSuiAddress() ?? null;
  const escrowId = toId<'Escrow'>(idStr);

  const [state, t] = await Promise.all([source.fetch(escrowId), resolveWhen(client, at)]);

  const reader = createReader(client, {
    packageId,
    escrowId,
    typeArguments: [state.assetType, state.coinType],
    ...(assetSchema ? { assetSchema } : {}),
  });

  const [floorMist, status, expiryMs, activeCapId, govCapId, inboxId, feeInboxId] = await Promise.all([
    reader.floorPriceMist(t),
    resolveStatus(reader),
    reader.tenureExpiryMs(),
    reader.activeUsufructCapId(),
    reader.governanceCapId(),
    reader.earningsInboxId(),
    reader.feeInboxId(),
  ]);

  // `accruedCreditMist` aborts on a non-rented escrow — read it only when rented.
  const rented = status === 'occupied' || status === 'demand';
  const [accruedMist, role] = await Promise.all([
    rented ? reader.accruedCreditMist(t) : Promise.resolve(mist(0n)),
    resolveRole(client, packageId, owner, activeCapId, govCapId, inboxId),
  ]);

  const coin = coinInfo(state.coinType);
  const typeArguments: [string, string] = [state.assetType, state.coinType];
  const cap: UsufructCap | null = role.capId
    ? createCap(ctx, {
        capId: role.capId,
        escrowId: idStr,
        typeArguments,
        receipt: null,
      })
    : null;
  const governanceCap: GovernanceCap | null = role.governs ? createGovernanceCap(ctx, govCapId) : null;
  const earnings: EarningsInbox | null = role.holdsEarnings ? createInbox(ctx, inboxId, 'earnings') : null;

  async function rent(args: { tenures: number; payment: Payment }): Promise<UsufructCap> {
    if (signer == null || owner == null) {
      throw new NotConnected('rent requires a signer; pass one to usufruct() or u.connect()');
    }
    const count = BigInt(args.tenures);
    const minimumMist = floorMist * count; // snapshot floor at fetch time `t`

    const tx = new Transaction();
    const { arg: payment, paidMist } = await resolvePayment(tx, client, owner, args.payment, {
      minimumMist,
      coinType: state.coinType,
    });
    const minted = rentAction({ tenures: tenureCount(count) }).toPtb(tx, {
      pkg: { packageId },
      escrowId,
      payment,
      typeArguments,
    });
    tx.transferObjects([minted], owner);

    const res = await execute(client, tx, signer).catch(mapAbort);
    const capId = createdIdByType(res, '::usufruct_cap::UsufructCap');
    if (capId == null) throw new Error(`rent: no UsufructCap created (digest ${res.digest})`);

    const expiry = await reader.tenureExpiryMs();
    return createCap(ctx, {
      capId,
      escrowId: idStr,
      typeArguments,
      receipt: {
        paid: price(paidMist, coin),
        expiresAt: new Date(Number(expiry ?? 0n)),
        digest: res.digest,
      },
    });
  }

  return {
    id: idStr,
    assetType: state.assetType,
    coinType: state.coinType,
    status,
    isAvailable: status === 'idle' || status === 'descent',
    floorPrice: price(floorMist, coin),
    accruedCredit: price(accruedMist, coin),
    expiresAt: expiryMs == null ? null : new Date(Number(expiryMs)),
    governanceCapId: govCapId,
    earningsInboxId: inboxId,
    feeInboxId,
    activeUsufructCapId: activeCapId,
    canRent: owner != null && status !== 'retired',
    canBorrow: role.capId != null,
    canGovern: role.governs,
    cap,
    governanceCap,
    earnings,
    rent,
    reader,
  };
}
