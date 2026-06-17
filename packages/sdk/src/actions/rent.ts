/**
 * `rent` — acquire (install) or bid for the right of use.
 *
 * Core (drift-zero) surface: the PTB builder only. The off-chain `step` that
 * predicts the curve-derived floor and assembles the successor state lives in
 * the mirror (`sim/actions/rent.ts`), which pairs it with `rentToPtb` here.
 */
import type { TransactionObjectArgument } from '@mysten/sui/transactions';
import { tenures as tenuresCall } from '../codegen/usufruct/ensemble.js';
import { rent as rentCall } from '../codegen/usufruct/escrow.js';
import type { PtbAction } from '../primitives/action.js';
import type { Id, Mist, TenureCount } from '../primitives/brand.js';
import type { PackageIds } from '../config/network.js';

export interface RentParams {
  readonly tenures: TenureCount;
  /** step-only: payment to validate against the floor (toPtb ignores it). */
  readonly paymentMist?: Mist;
  /** step-only: usufructuary address for the new seat. */
  readonly sender?: string;
  /** step-only: placeholder for the chain-minted UsufructCap id. */
  readonly capId?: string;
}

export interface RentResult {
  /** The curve-derived floor the chain charges per the current state. */
  readonly floorMist: Mist;
  readonly transition: 'install' | 'bid' | 'supersede';
}

export interface RentPtbArgs {
  readonly pkg: Pick<PackageIds, 'packageId'>;
  readonly escrowId: Id<'Escrow'>;
  /** Payment coin (id or result of a previous command, e.g. a split). */
  readonly payment: string | TransactionObjectArgument;
  readonly typeArguments: [string, string];
}

/** Appends the `rent` Move call. Returns the freshly-minted `UsufructCap`. */
export function rentToPtb(params: RentParams): PtbAction<RentPtbArgs>['toPtb'] {
  return (tx, args) =>
    tx.add(
      rentCall({
        package: args.pkg.packageId,
        arguments: [
          args.escrowId,
          args.payment,
          tx.add(tenuresCall({ package: args.pkg.packageId, arguments: [params.tenures] })),
        ],
        typeArguments: args.typeArguments,
      }),
    );
}

export function rent(params: RentParams): PtbAction<RentPtbArgs> {
  return { toPtb: rentToPtb(params) };
}
