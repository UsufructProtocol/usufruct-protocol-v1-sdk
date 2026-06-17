/**
 * `borrow_asset` / `return_asset` — the mirror (off-chain `step` pair), paired
 * with the core's `borrowToPtb` / `returnAssetToPtb`. `step` mirrors the engine:
 * borrow settles pending, requires the ACTIVE cap, empties the escrow's state
 * slot into an off-chain receipt; `returnAsset(receipt).step` restores it.
 *
 * Re-exports the core's PTB-only surface (`withBorrowedAsset`) and the shared
 * types, so `sim/actions` is a superset of the core action module.
 */
import {
  borrowToPtb,
  returnAssetToPtb,
  withBorrowedAsset,
  type BorrowPtbArgs,
  type BorrowReceipt,
  type BorrowResult,
  type ReturnPtbArgs,
} from '@usufruct-protocol/sdk/actions/borrow.js';
import type { TransitionAction } from '@usufruct-protocol/sdk/primitives/action.js';
import type { Ms } from '@usufruct-protocol/sdk/primitives/brand.js';
import { id } from '@usufruct-protocol/sdk/primitives/brand.js';
import type { EscrowState } from '@usufruct-protocol/sdk/primitives/state.js';
import { applyPendingTransitionStates } from './apply.js';

export { withBorrowedAsset };
export type { BorrowPtbArgs, BorrowReceipt, BorrowResult, ReturnPtbArgs };

type State = EscrowState;
type AssetStateData = NonNullable<State['escrow']['state']>;
type RentingData = Extract<AssetStateData, { $kind: 'Renting' }>['Renting'];

export function borrowAsset(params: {
  /** The cap attempting the borrow — must be the active cap. */
  readonly usufructCapId: string;
}): TransitionAction<BorrowResult, BorrowPtbArgs> {
  return {
    step: (state, t) => {
      // The engine settles pending transitions before borrowing.
      const settled = applyPendingTransitionStates().step(state, t).state;
      const s = settled.escrow.state;
      if (s == null) throw new Error('EAssetBorrowed: asset already borrowed');
      if (s.$kind !== 'Renting') throw new Error('EStaleUsufructCap: escrow is not rented');
      const r = s.Renting;
      const terms = r.$kind === 'Occupied' ? r.Occupied.terms : r.Demand.terms;
      if (terms.active.identity.cap_identity.id !== params.usufructCapId) {
        throw new Error('EStaleUsufructCap: only the active cap can borrow');
      }
      const custody = r.$kind === 'Occupied' ? r.Occupied.asset : r.Demand.asset;
      if (custody.available == null) throw new Error('EAssetBorrowed: custody is empty');
      const assetId = id<'Asset'>(custody.identity.asset_id.proj_id);

      // Extract: custody.available → null inside the receipt's renting state.
      const drained = { ...custody, available: null };
      const renting = (
        r.$kind === 'Occupied'
          ? { ...r, Occupied: { ...r.Occupied, asset: drained } }
          : { ...r, Demand: { ...r.Demand, asset: drained } }
      ) as RentingData;

      const next: State = {
        ...settled,
        escrow: { ...settled.escrow, state: null },
      };
      return {
        state: next,
        result: {
          receipt: {
            escrowId: settled.objectId,
            assetId,
            asset: custody.available,
            renting,
          },
        },
      };
    },
    toPtb: borrowToPtb(),
  };
}

export function returnAsset(receipt: BorrowReceipt): TransitionAction<null, ReturnPtbArgs> {
  return {
    step: (state) => {
      if (state.escrow.state != null) {
        throw new Error('return_asset: escrow state slot is not empty');
      }
      if (state.objectId !== receipt.escrowId) {
        throw new Error('EReceiptEscrowMismatch');
      }
      const r = receipt.renting;
      const custody = r.$kind === 'Occupied' ? r.Occupied.asset : r.Demand.asset;
      // Refill: the returned asset must be the one the receipt names; the
      // off-chain mirror restores the recorded value (the chain checks ids).
      const refilled = { ...custody, available: receipt.asset };
      const renting = (
        r.$kind === 'Occupied'
          ? { ...r, Occupied: { ...r.Occupied, asset: refilled } }
          : { ...r, Demand: { ...r.Demand, asset: refilled } }
      ) as RentingData;
      const next: State = {
        ...state,
        escrow: {
          ...state.escrow,
          state: { $kind: 'Renting', Renting: renting } as AssetStateData,
        },
      };
      return { state: next, result: null };
    },
    toPtb: returnAssetToPtb,
  };
}

/**
 * Pure mirror of the bracket for simulator/testbed use. `use` receives the
 * decoded asset value and models the foreign API's effect on it (it takes the
 * asset "by mutable reference": return the possibly-updated value).
 *
 * The SDK guarantees the *escrow* round-trip; what the foreign code does to the
 * *asset* is the caller's model — the SDK cannot know other protocols'
 * semantics (§8.2 discipline applies to them, not us).
 */
export function withBorrowedAssetStep<A, T>(
  state: EscrowState,
  t: Ms,
  usufructCapId: string,
  use: (asset: A) => { readonly asset: A; readonly result: T },
): { state: EscrowState; result: T } {
  const borrowed = borrowAsset({ usufructCapId }).step(state, t);
  const used = use(borrowed.result.receipt.asset as A);
  const { state: restored } = returnAsset({
    ...borrowed.result.receipt,
    asset: used.asset,
  }).step(borrowed.state, t);
  return { state: restored, result: used.result };
}
