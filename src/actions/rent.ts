/**
 * `rent` — Transition action: acquire the right of use.
 * `step` is not yet golden-tested (floor-price evaluation crosses curve
 * math); `toPtb` is complete.
 */
import type { TransactionObjectArgument } from '@mysten/sui/transactions';
import { tenures as tenuresCall } from '../codegen/usufruct/ensemble.js';
import { rent as rentCall } from '../codegen/usufruct/escrow.js';
import type { TransitionAction } from '../primitives/action.js';
import { NotImplementedStepError } from '../primitives/action.js';
import type { Id, TenureCount } from '../primitives/brand.js';
import type { PackageIds } from '../config/network.js';

export interface RentParams {
  /** Number of tenures to commit. */
  readonly tenures: TenureCount;
}

export interface RentPtbArgs {
  readonly pkg: Pick<PackageIds, 'packageId'>;
  readonly escrowId: Id<'Escrow'>;
  /** Payment coin (id or result of a previous command, e.g. a split). */
  readonly payment: string | TransactionObjectArgument;
  readonly typeArguments: [string, string];
}

export function rent(params: RentParams): TransitionAction<null, RentPtbArgs> {
  return {
    step: () => {
      throw new NotImplementedStepError('rent');
    },
    // Returns the UsufructCap — the caller must transfer or consume it.
    toPtb: (tx, args) =>
      tx.add(
        rentCall({
          package: args.pkg.packageId,
          arguments: [
            args.escrowId,
            args.payment,
            tx.add(
              tenuresCall({ package: args.pkg.packageId, arguments: [params.tenures] }),
            ),
          ],
          typeArguments: args.typeArguments,
        }),
      ),
  };
}
