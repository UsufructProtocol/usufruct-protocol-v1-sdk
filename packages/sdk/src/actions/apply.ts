/**
 * `apply_pending_transition_states` — the lazy-settlement transition.
 *
 * Core (drift-zero) surface: the PTB builder only. The off-chain `step` that
 * mirrors the settlement (handover → tenure-expiry → auction-expiry) and the
 * curve-derived economic split lives in the mirror (`sim/actions/apply.ts`),
 * which pairs it with `applyToPtb` here.
 */
import { applyPendingTransitionStates as applyCall } from '../codegen/usufruct/escrow.js';
import type { Id, Mist } from '../primitives/brand.js';
import type { PtbAction } from '../primitives/action.js';
import type { PackageIds } from '../config/network.js';

export interface ApplyPtbArgs {
  readonly pkg: Pick<PackageIds, 'packageId'>;
  readonly escrowId: Id<'Escrow'>;
  readonly typeArguments: [string, string];
}

export type AppliedTransition = 'handover' | 'tenureExpiry' | 'auctionExpiry' | 'retire';

/** Economic split of a handover settlement (curve-derived). */
export interface HandoverSettlement {
  readonly usedMist: Mist;
  readonly governorShareMist: Mist;
  readonly feeMist: Mist;
  /** Departing usufructuary's refund (unused credit). */
  readonly refundMist: Mist;
  /** New rent price seeding the incoming tenancy. */
  readonly newRentPriceMist: Mist;
}

/**
 * Economic split of a tenure-expiry settlement. Unlike a handover (partial,
 * curve-derived, with a refund), a tenure that runs its full committed term
 * consumes the **entire** stake — no refund, no reprice — so `do_tenure_expiry`
 * settles `splitFee(principal)`. Mirrors the `tenureSettlement` on-chain view.
 */
export interface TenureSettlement {
  /** Consumed credit = the full active stake. */
  readonly usedMist: Mist;
  readonly governorShareMist: Mist;
  readonly feeMist: Mist;
}

export interface ApplyResult {
  readonly transitions: readonly AppliedTransition[];
  /** Present iff a handover fired (partial, curve-derived). */
  readonly settlement?: HandoverSettlement;
  /** Present iff a tenure expiry fired (full stake, no refund). */
  readonly tenureSettlement?: TenureSettlement;
}

/** Appends the `apply_pending_transition_states` Move call. */
export function applyToPtb(): PtbAction<ApplyPtbArgs>['toPtb'] {
  return (tx, args) =>
    tx.add(
      applyCall({
        package: args.pkg.packageId,
        arguments: [args.escrowId],
        typeArguments: args.typeArguments,
      }),
    );
}

export function applyPendingTransitionStates(): PtbAction<ApplyPtbArgs> {
  return { toPtb: applyToPtb() };
}
