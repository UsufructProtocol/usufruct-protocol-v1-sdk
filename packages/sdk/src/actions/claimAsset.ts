/**
 * `claim_asset` — the Terminal action: consumes a retired escrow and returns
 * the asset.
 *
 * Core (drift-zero) surface: the PTB builder only. The off-chain `step` (which
 * settles pending first, then reads the asset id) lives in the mirror
 * (`sim/actions/claimAsset.ts`), which pairs it with `claimAssetToPtb`.
 */
import { claimAsset as claimAssetCall } from '../codegen/usufruct/escrow.js';
import type { PtbAction } from '../primitives/action.js';
import type { Id } from '../primitives/brand.js';
import type { PackageIds } from '../config/network.js';

export interface ClaimAssetPtbArgs {
  readonly pkg: Pick<PackageIds, 'packageId'>;
  readonly escrowId: Id<'Escrow'>;
  readonly governanceCapId: Id<'GovernanceCap'>;
  readonly typeArguments: [string, string];
}

export interface ClaimResult {
  readonly assetId: Id<'Asset'>;
}

/** Appends the `claim_asset` Move call. Returns the unwrapped `Asset`. */
export function claimAssetToPtb(): PtbAction<ClaimAssetPtbArgs>['toPtb'] {
  return (tx, args) =>
    tx.add(
      claimAssetCall({
        package: args.pkg.packageId,
        arguments: [args.escrowId, args.governanceCapId],
        typeArguments: args.typeArguments,
      }),
    );
}

export function claimAsset(): PtbAction<ClaimAssetPtbArgs> {
  return { toPtb: claimAssetToPtb() };
}
