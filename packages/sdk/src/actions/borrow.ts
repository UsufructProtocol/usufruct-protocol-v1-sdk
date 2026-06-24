/**
 * `borrow_asset` / `return_asset` — the hot-potato pair. The receipt has no
 * abilities, so a borrow MUST be returned within the same PTB.
 *
 * Core (drift-zero) surface: the PTB builders and the `withBorrowedAsset`
 * bracket (borrow → user commands → return, in one PTB). The off-chain `step`
 * pair and the pure `withBorrowedAssetStep` bracket live in the mirror
 * (`sim/actions/borrow.ts`), which pairs the steps with these builders.
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
import type { PtbAction } from '../primitives/action.js';
import type { Id } from '../primitives/brand.js';
import type { PackageIds } from '../config/network.js';

// The off-chain `BorrowReceipt`/`BorrowResult` (decoded renting state) are a
// mirror concern — they live in `@usufruct-protocol/sim` with the `step` pair.
// Core keeps only the PTB builders below.

export interface BorrowPtbArgs {
  readonly pkg: Pick<PackageIds, 'packageId'>;
  readonly escrowId: Id<'Escrow'>;
  readonly usufructCapId: string;
  readonly typeArguments: [string, string];
}

/** The `borrow_asset` PTB builder. Returns `[asset, receipt]` — both consumed in-PTB. */
export function borrowToPtb(): PtbAction<BorrowPtbArgs> {
  return (tx, args) =>
    tx.add(
      borrowCall({
        package: args.pkg.packageId,
        arguments: [args.escrowId, args.usufructCapId],
        typeArguments: args.typeArguments,
      }),
    );
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

export function returnAssetToPtb(tx: Transaction, args: ReturnPtbArgs): TransactionResult {
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

/**
 * The composability bracket: borrow → user commands → return, in one PTB.
 *
 * `use` runs while the PTB is being built — whatever commands it appends land
 * between the borrow and the return, with the borrowed asset handle as their
 * argument. The user never touches the receipt, so the well-formed hot-potato
 * PTB is the only one this can produce. Because the SAME borrowed handle is what
 * gets returned, the middle must take the asset by reference (`&Asset` /
 * `&mut Asset`): consuming it by value leaves nothing to return and the chain
 * rejects the PTB at resolution. The rare by-value-and-return-intact case (`fun
 * f(a: Asset): Asset`) drops to the bare `borrowToPtb`/`returnAssetToPtb` pair,
 * threading the returned handle into `return_asset` yourself.
 *
 * Returns whatever `use` returns (e.g. artifact handles to transfer). Brackets
 * nest for cross-escrow composition — one per escrow/cap pair.
 */
export function withBorrowedAsset<T>(
  tx: Transaction,
  args: BorrowPtbArgs,
  use: (asset: TransactionObjectArgument, tx: Transaction) => T,
): T {
  const handles = borrowToPtb()(tx, args);
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
