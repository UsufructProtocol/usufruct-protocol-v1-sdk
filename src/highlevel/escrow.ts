/**
 * The `Escrow` handle (Layer 2) — the hub: one batched read snapshot, the
 * signer's resolved role, and (Phase C) the permissionless writes.
 *
 * One `await` (`u.escrow(id)`) resolves state, the curated read getters at a
 * single time `t`, *and* the signer's role here — so everything below is sync.
 * The reads are a snapshot at `t` (the fetch time); for live values use the
 * kernel `reader` (exposed) or, later, `watch`/`priceCurve`.
 */
import type { ClientWithCoreApi } from '@mysten/sui/client';
import { id as toId } from '../primitives/brand.js';
import { createReader, type Reader } from '../read/reader.js';
import type { Source } from '../primitives/source.js';
import type { UsufructCap } from './cap.js';
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

  // the signer's role here, resolved in the same fetch
  readonly canRent: boolean;
  readonly canBorrow: boolean;
  readonly canGovern: boolean;
  readonly cap: UsufructCap | null;

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
export async function createEscrow(
  client: ClientWithCoreApi,
  packageId: string,
  source: Source,
  owner: string | null,
  idStr: string,
  at?: When,
): Promise<Escrow> {
  const escrowId = toId<'Escrow'>(idStr);

  const [state, t] = await Promise.all([source.fetch(escrowId), resolveWhen(client, at)]);

  const reader = createReader(client, {
    packageId,
    escrowId,
    typeArguments: [state.assetType, state.coinType],
  });

  const [floorMist, accruedMist, status, expiryMs, activeCapId, govCapId] = await Promise.all([
    reader.floorPriceMist(t),
    reader.accruedCreditMist(t),
    resolveStatus(reader),
    reader.tenureExpiryMs(),
    reader.activeUsufructCapId(),
    reader.governanceCapId(),
  ]);

  const role = await resolveRole(client, packageId, owner, activeCapId, govCapId);

  const coin = coinInfo(state.coinType);
  const cap: UsufructCap | null = role.capId
    ? { id: role.capId, escrowId: idStr, receipt: null }
    : null;

  return {
    id: idStr,
    assetType: state.assetType,
    coinType: state.coinType,
    status,
    isAvailable: status === 'idle' || status === 'descent',
    floorPrice: price(floorMist, coin),
    accruedCredit: price(accruedMist, coin),
    expiresAt: expiryMs == null ? null : new Date(Number(expiryMs)),
    canRent: owner != null && status !== 'retired',
    canBorrow: role.capId != null,
    canGovern: role.governs,
    cap,
    reader,
  };
}
