/**
 * `claim_asset` — the Terminal action: consumes a retired escrow and
 * returns the asset. `step` returns no successor state — the compiler
 * rejects chaining anything after it.
 */
import { claimAsset as claimAssetCall } from '../codegen/usufruct/escrow.js';
import type { TerminalAction } from '../primitives/action.js';
import type { Id, Ms } from '../primitives/brand.js';
import type { AssetSchema, EscrowState } from '../primitives/state.js';
import type { PackageIds } from '../config/network.js';
import { assetId } from '../views/identity.js';
import { applyPendingTransitionStates } from './apply.js';

export interface ClaimAssetPtbArgs {
  readonly pkg: Pick<PackageIds, 'packageId'>;
  readonly escrowId: Id<'Escrow'>;
  readonly governanceCapId: Id<'GovernanceCap'>;
  readonly typeArguments: [string, string];
}

export interface ClaimResult {
  readonly assetId: Id<'Asset'>;
}

/** `claim_asset` requires a Retired escrow; settle pending first, then consume. */
export function claimAsset(): TerminalAction<ClaimResult, ClaimAssetPtbArgs> {
  return {
    step: (state: EscrowState<AssetSchema>, t: Ms) => {
      const settled = applyPendingTransitionStates().step(state, t).state;
      const s = settled.escrow.state;
      if (s == null || s.$kind !== 'Waiting' || s.Waiting.$kind !== 'Retired') {
        throw new Error('ENotRetired');
      }
      return { result: { assetId: assetId(settled, t) } };
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
