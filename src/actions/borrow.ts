/**
 * `borrow_asset` / `return_asset` — the hot-potato pair. The receipt has no
 * abilities, so a borrow MUST be returned within the same PTB; `toPtb`
 * returns the `[asset, receipt]` handles for the caller to thread.
 *
 * `step` mirrors the engine exactly: borrow applies pending transitions,
 * requires the ACTIVE cap (a pending bidder cannot borrow), and empties the
 * escrow's `state` slot, packaging the extracted `RentingState` into an
 * off-chain receipt. `returnAsset(receipt).step` restores it — the
 * composition is the identity on a settled Occupied state.
 */
import type {
  Transaction,
  TransactionObjectArgument,
  TransactionResult,
} from '@mysten/sui/transactions';
import {
  borrowAsset as borrowCall,
  returnAsset as returnCall,
} from '../codegen/usufruct/escrow.js';
import type { TransitionAction } from '../primitives/action.js';
import type { Id, Ms } from '../primitives/brand.js';
import { id } from '../primitives/brand.js';
import type { EscrowState } from '../primitives/state.js';
import type { PackageIds } from '../config/network.js';
import { applyPendingTransitionStates } from './apply.js';

type State = EscrowState;
type AssetStateData = NonNullable<State['escrow']['state']>;
type RentingData = Extract<AssetStateData, { $kind: 'Renting' }>['Renting'];

/** Off-chain mirror of `AssetReceipt`: the extracted renting state. */
export interface BorrowReceipt {
  readonly escrowId: Id<'Escrow'>;
  readonly assetId: Id<'Asset'>;
  /** The decoded asset value travelling outside the escrow. */
  readonly asset: unknown;
  readonly renting: RentingData;
}

export interface BorrowResult {
  readonly receipt: BorrowReceipt;
}

export interface BorrowPtbArgs {
  readonly pkg: Pick<PackageIds, 'packageId'>;
  readonly escrowId: Id<'Escrow'>;
  readonly usufructCapId: string;
  readonly typeArguments: [string, string];
}

export function borrowAsset(params: {
  /** The cap attempting the borrow — must be the active cap. */
  readonly usufructCapId: string;
}): TransitionAction<BorrowResult, BorrowPtbArgs> {
  return {
    step: (state, t, opts) => {
      // The engine settles pending transitions before borrowing.
      const settled = applyPendingTransitionStates().step(state, t, opts).state;
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

    // Returns [asset, receipt] — both MUST be consumed in this PTB
    // (the receipt is a hot-potato; the chain rejects the tx otherwise).
    toPtb: (tx, args) =>
      tx.add(
        borrowCall({
          package: args.pkg.packageId,
          arguments: [args.escrowId, args.usufructCapId],
          typeArguments: args.typeArguments,
        }),
      ),
  };
}

export interface ReturnPtbArgs {
  readonly pkg: Pick<PackageIds, 'packageId'>;
  readonly escrowId: Id<'Escrow'>;
  /** The asset handle from the borrow command in this PTB. */
  readonly asset: TransactionObjectArgument;
  /** The receipt handle from the borrow command in this PTB. */
  readonly receipt: TransactionResult[number] | TransactionObjectArgument;
  readonly typeArguments: [string, string];
}

function returnAssetToPtb(tx: Transaction, args: ReturnPtbArgs): TransactionResult {
  return tx.add(
    returnCall({
      package: args.pkg.packageId,
      arguments: [
        tx.object(args.escrowId),
        args.asset,
        args.receipt as TransactionObjectArgument,
      ],
      typeArguments: args.typeArguments,
    }),
  );
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
 * The composability bracket: borrow → user commands → return, in one PTB.
 *
 * `use` runs while the PTB is being built — whatever commands it appends
 * land between the borrow and the return, with the borrowed asset handle as
 * their argument. The user never touches the receipt, so the well-formed
 * hot-potato PTB is the only one this can produce. External APIs must take
 * the asset by reference (`&Asset` / `&mut Asset`): consuming it by value
 * leaves nothing to return and the chain rejects the PTB at resolution.
 *
 * Returns whatever `use` returns (e.g. artifact handles to transfer).
 * Brackets nest for cross-escrow composition — one per escrow/cap pair.
 */
export function withBorrowedAsset<T>(
  tx: Transaction,
  args: BorrowPtbArgs,
  use: (asset: TransactionObjectArgument, tx: Transaction) => T,
): T {
  const handles = borrowAsset({ usufructCapId: args.usufructCapId }).toPtb(tx, args);
  const asset = handles[0]! as TransactionObjectArgument;
  const result = use(asset, tx);
  returnAssetToPtb(tx, {
    pkg: args.pkg,
    escrowId: args.escrowId,
    asset,
    receipt: handles[1]!,
    typeArguments: args.typeArguments,
  });
  return result;
}

/**
 * Pure mirror of the bracket for simulator/testbed use. `use` receives the
 * decoded asset value and models the foreign API's effect on it (it takes
 * the asset "by mutable reference": return the possibly-updated value).
 *
 * The SDK guarantees the *escrow* round-trip; what the foreign code does to
 * the *asset* is the caller's model — the SDK cannot know other protocols'
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
