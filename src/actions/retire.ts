/**
 * `retire` — the governor signals retirement. Resolved lazily by the engine:
 * immediate when Waiting (Idle/Descent → Retired), a flag when rented.
 *
 * Core (drift-zero) surface: the PTB builder only. The off-chain `step` lives
 * in the mirror (`sim/actions/retire.ts`), which pairs it with `retireToPtb`.
 */
import { retire as retireCall } from '../codegen/usufruct/escrow.js';
import type { PtbAction } from '../primitives/action.js';
import type { Id } from '../primitives/brand.js';
import type { PackageIds } from '../config/network.js';

export interface RetirePtbArgs {
  readonly pkg: Pick<PackageIds, 'packageId'>;
  readonly escrowId: Id<'Escrow'>;
  readonly governanceCapId: Id<'GovernanceCap'>;
  readonly typeArguments: [string, string];
}

/** Appends the `retire` Move call. */
export function retireToPtb(): PtbAction<RetirePtbArgs>['toPtb'] {
  return (tx, args) =>
    tx.add(
      retireCall({
        package: args.pkg.packageId,
        arguments: [args.escrowId, args.governanceCapId],
        typeArguments: args.typeArguments,
      }),
    );
}

export function retire(): PtbAction<RetirePtbArgs> {
  return { toPtb: retireToPtb() };
}
