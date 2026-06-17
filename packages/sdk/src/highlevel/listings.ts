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
import { UsufructError } from './errors.js';

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

/**
 * One `UsufructCap` an escrow ever minted, from a `UsufructCapMinted` event — the
 * escrow's roster of renters/bidders (active, pending, or long-burned). The cap
 * stores its escrow on-chain (unlike the GovernanceCap), but the reverse — every
 * cap an escrow minted — lives only in this event.
 */
export interface UsufructCapRecord {
  readonly usufructCapId: string;
  readonly escrowId: string;
  readonly usufructuary: string;
  /** When it was minted (event emission time), or `null`. */
  readonly mintedAt: Date | null;
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

/**
 * Stream `AssetIntegrated` events and map the matching ones to `EscrowListing`s.
 * `sender` narrows server-side; the rest are exact client-side filters on the
 * event payload (`integrator` = integration-time governor; `governanceCapId` =
 * the cap that governs it; `ownedCaps` = "a cap I hold"). Deduped by escrow id.
 * Needs the indexer (a `graphql` endpoint).
 */
export async function discoverIntegrated(
  ctx: HandleCtx,
  filter: {
    sender?: string;
    integrator?: string;
    assetType?: string;
    coinType?: string;
    governanceCapId?: string;
    earningsInboxId?: string;
    feeInboxId?: string;
    ownedCaps?: ReadonlySet<string>;
    escrowIds?: ReadonlySet<string>;
  },
): Promise<EscrowListing[]> {
  if (ctx.indexer == null) {
    throw new UsufructError('discovery requires a GraphQL endpoint — pass `graphql` to usufruct()');
  }
  const type = `${ctx.packageId}::asset_state::AssetIntegrated`;
  const out: EscrowListing[] = [];
  const seen = new Set<string>();
  for await (const ev of ctx.indexer.events({ type, ...(filter.sender ? { sender: filter.sender } : {}) })) {
    const j = ev.json;
    const cap = s(j['governance_cap_id']);
    if (filter.integrator && s(j['governor_address']) !== filter.integrator) continue;
    if (filter.assetType && normType(s(j['asset_type'])) !== filter.assetType) continue;
    if (filter.coinType && normType(s(j['coin_type'])) !== filter.coinType) continue;
    if (filter.governanceCapId && cap !== filter.governanceCapId) continue;
    if (filter.earningsInboxId && s(j['earnings_inbox_id']) !== filter.earningsInboxId) continue;
    if (filter.feeInboxId && s(j['fee_inbox_id']) !== filter.feeInboxId) continue;
    if (filter.ownedCaps && !filter.ownedCaps.has(cap)) continue;
    const id = s(j['escrow_id']);
    if (filter.escrowIds && !filter.escrowIds.has(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(createListing(ctx, { json: j, timestamp: ev.timestamp }));
  }
  return out;
}
