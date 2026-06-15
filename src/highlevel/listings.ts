/**
 * Escrow discovery (Layer 2) — the high-level over the indexer's typed events.
 *
 * Finding escrows by relationship ("the ones I govern", "the ones of this asset
 * type") means reading `AssetIntegrated` events. The kernel/indexer already
 * decodes them; this is the ergonomic door: a typed, decode-free `EscrowListing`
 * (every field comes straight from the event — no per-escrow fetch), with a
 * back-edge to resolve the full `Escrow` handle on demand.
 */
import { normalizeStructTag } from '@mysten/sui/utils';
import type { HandleCtx } from './ctx.js';
import { createEscrow, type Escrow } from './escrow.js';

/** An escrow's identities, read from its `AssetIntegrated` event (decode-free). */
export interface EscrowListing {
  readonly escrowId: string;
  readonly assetType: string;
  readonly coinType: string;
  readonly governanceCapId: string;
  readonly earningsInboxId: string;
  readonly feeInboxId: string;
  /** The address that integrated it (the original governor). */
  readonly governor: string;
  /** When it was integrated (event emission time), or `null`. */
  readonly integratedAt: Date | null;
  /** Resolve the full `Escrow` handle (state + the signer's role here). */
  escrow(): Promise<Escrow>;
}

const s = (v: unknown): string => String(v ?? '');
/** Normalize a Move type string; event json drops the `0x` on the address. */
export function normType(v: string): string {
  const t = v.startsWith('0x') ? v : `0x${v}`;
  try {
    return normalizeStructTag(t);
  } catch {
    return t;
  }
}

/** Build an `EscrowListing` from one decoded `AssetIntegrated` event payload. */
export function createListing(
  ctx: HandleCtx,
  e: { readonly json: Record<string, unknown>; readonly timestamp: string | null },
): EscrowListing {
  const j = e.json;
  const escrowId = s(j['escrow_id']);
  return {
    escrowId,
    assetType: normType(s(j['asset_type'])),
    coinType: normType(s(j['coin_type'])),
    governanceCapId: s(j['governance_cap_id']),
    earningsInboxId: s(j['earnings_inbox_id']),
    feeInboxId: s(j['fee_inbox_id']),
    governor: s(j['governor_address']),
    integratedAt: e.timestamp ? new Date(e.timestamp) : null,
    escrow: () => createEscrow(ctx, escrowId),
  };
}
