/**
 * Seat views — active/pending usufructuary identity, stakes, tenures, and
 * cap verification. Mirrors `asset_state::proj_active_*` / `proj_pending_*`
 * and `cap_is_active/_is_pending/_is_stale`.
 */
import { mist, tenureCount, type Id, type Mist, type TenureCount, id } from '../primitives/brand.js';
import type { View } from '../primitives/view.js';
import { UsufructCap } from '../codegen/usufruct/usufruct_cap.js';
import { ProtocolFeeRef } from '../codegen/usufruct/protocol_fee_ref.js';
import { assetState, core, rentingTerms, type AssetStateData } from './internal.js';

/** Demand bid terms, or null when not in Demand. */
function demandBid(s: AssetStateData) {
  return s.$kind === 'Renting' && s.Renting.$kind === 'Demand' ? s.Renting.Demand.bid : null;
}

/** Mirrors `is_retiring`: the retire flag on the occupied terms. */
export const isRetiring: View<boolean> = (state) => {
  const terms = rentingTerms(assetState(state));
  return terms !== null && terms.retire.$kind === 'Retiring';
};

export const activeUsufructCapId: View<Id<'UsufructCap'> | null> = (state) => {
  const terms = rentingTerms(assetState(state));
  return terms === null ? null : id<'UsufructCap'>(terms.active.identity.cap_identity.id);
};

export const pendingUsufructuaryAddr: View<string | null> = (state) => {
  const bid = demandBid(assetState(state));
  return bid === null ? null : bid.pending.identity.address.addr;
};

export const pendingUsufructCapId: View<Id<'UsufructCap'> | null> = (state) => {
  const bid = demandBid(assetState(state));
  return bid === null ? null : id<'UsufructCap'>(bid.pending.identity.cap_identity.id);
};

export const activeStakeBalanceMist: View<Mist | null> = (state) => {
  const terms = rentingTerms(assetState(state));
  return terms === null ? null : mist(terms.active.stake.balance.value);
};

export const pendingStakeBalanceMist: View<Mist | null> = (state) => {
  const bid = demandBid(assetState(state));
  return bid === null ? null : mist(bid.pending.stake.balance.value);
};

export const activeCommittedTenures: View<TenureCount | null> = (state) => {
  const terms = rentingTerms(assetState(state));
  return terms === null ? null : tenureCount(terms.schedule.committed_tenures.count);
};

export const pendingCommittedTenures: View<TenureCount | null> = (state) => {
  const bid = demandBid(assetState(state));
  return bid === null ? null : tenureCount(bid.handover.tenures.count);
};

export const earningsInboxId: View<Id<'EarningsInbox'>> = (state) =>
  id<'EarningsInbox'>(core(state).governor_seat.inbox.id);

export const feeInboxId: View<Id<'ProtocolFeeInbox'>> = (state) =>
  id<'ProtocolFeeInbox'>(core(state).fee_inbox_identity.id);

// ── Cap verification factories — mirror `governance_cap_is_valid`,
// `usufruct_cap_is_active/_is_pending/_is_stale` (which take a cap id). ──

export const governanceCapIsValid =
  (capId: string): View<boolean> =>
  (state) =>
    core(state).governor_seat.identity.cap_identity.id === capId;

export const usufructCapIsActive =
  (capId: string): View<boolean> =>
  (state) => {
    const terms = rentingTerms(assetState(state));
    return terms !== null && terms.active.identity.cap_identity.id === capId;
  };

export const usufructCapIsPending =
  (capId: string): View<boolean> =>
  (state) => {
    const bid = demandBid(assetState(state));
    return bid !== null && bid.pending.identity.cap_identity.id === capId;
  };

export const usufructCapIsStale =
  (capId: string): View<boolean> =>
  (state, t) =>
    !usufructCapIsActive(capId)(state, t) && !usufructCapIsPending(capId)(state, t);

// ── Projections over other decoded objects (not Views over EscrowState) ──

/** Mirrors `cap::usufruct_cap_escrow_id` over a decoded `UsufructCap`. */
export function usufructCapEscrowId(
  cap: ReturnType<typeof UsufructCap.parse>,
): Id<'Escrow'> {
  return id<'Escrow'>(cap.escrow_identity.id);
}

/** Mirrors `fees::inbox_id` over a decoded `ProtocolFeeRef`. */
export function feeRefInboxId(
  ref: ReturnType<typeof ProtocolFeeRef.parse>,
): Id<'ProtocolFeeInbox'> {
  return id<'ProtocolFeeInbox'>(ref.proj_id.id);
}
