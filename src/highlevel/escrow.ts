/**
 * The `Escrow` handle (Layer 2) — the hub: a batched read snapshot, the
 * signer's resolved role, and the permissionless writes.
 *
 * NOTE: the batched fetch + sync getters land in Phase B and `rent` in Phase C.
 * This is the minimal shape the factory returns.
 */
import type { Price } from './value.js';
import type { UsufructCap } from './cap.js';

export type EscrowStatus = 'idle' | 'descent' | 'occupied' | 'demand' | 'retired';

/** The hub handle. Reads are sync getters off one fetch; writes return handles. */
export interface Escrow {
  readonly id: string;
  readonly assetType: string;
  readonly coinType: string;

  // reads (snapshot at fetch time `t`)
  readonly status: EscrowStatus;
  readonly isAvailable: boolean;
  readonly floorPrice: Price;
  readonly expiresAt: Date | null;

  // the signer's role here, resolved in the same fetch
  readonly canRent: boolean;
  readonly canBorrow: boolean;
  readonly canGovern: boolean;
  readonly cap: UsufructCap | null;
}
