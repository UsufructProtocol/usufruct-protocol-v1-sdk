/**
 * `retire` — Transition action: governor signals retirement; the state
 * machine resolves it lazily (immediately when Idle, at tenure end when
 * rented). `step` is not yet golden-tested.
 */
import { retire as retireCall } from '../codegen/usufruct/escrow.js';
import type { TransitionAction } from '../primitives/action.js';
import { NotImplementedStepError } from '../primitives/action.js';
import type { Id } from '../primitives/brand.js';
import type { PackageIds } from '../config/network.js';

export interface RetirePtbArgs {
  readonly pkg: Pick<PackageIds, 'packageId'>;
  readonly escrowId: Id<'Escrow'>;
  readonly governanceCapId: Id<'GovernanceCap'>;
  readonly typeArguments: [string, string];
}

export function retire(): TransitionAction<null, RetirePtbArgs> {
  return {
    step: () => {
      throw new NotImplementedStepError('retire');
    },
    toPtb: (tx, args) =>
      tx.add(
        retireCall({
          package: args.pkg.packageId,
          arguments: [args.escrowId, args.governanceCapId],
          typeArguments: args.typeArguments,
        }),
      ),
  };
}
