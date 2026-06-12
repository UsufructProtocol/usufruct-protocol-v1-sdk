/**
 * `claim_asset` — the Terminal action: consumes a retired escrow and
 * returns the asset. `step` returns no successor state — the compiler
 * rejects chaining anything after it.
 */
import { claimAsset as claimAssetCall } from '../codegen/usufruct/escrow.js';
import type { TerminalAction } from '../primitives/action.js';
import { NotImplementedStepError } from '../primitives/action.js';
import type { Id } from '../primitives/brand.js';
import type { PackageIds } from '../config/network.js';

export interface ClaimAssetPtbArgs {
  readonly pkg: Pick<PackageIds, 'packageId'>;
  readonly escrowId: Id<'Escrow'>;
  readonly governanceCapId: Id<'GovernanceCap'>;
  readonly typeArguments: [string, string];
}

export function claimAsset(): TerminalAction<null, ClaimAssetPtbArgs> {
  return {
    step: () => {
      throw new NotImplementedStepError('claimAsset');
    },
    // Returns the Asset — the caller must transfer or consume it.
    toPtb: (tx, args) =>
      tx.add(
        claimAssetCall({
          package: args.pkg.packageId,
          arguments: [args.escrowId, args.governanceCapId],
          typeArguments: args.typeArguments,
        }),
      ),
  };
}
