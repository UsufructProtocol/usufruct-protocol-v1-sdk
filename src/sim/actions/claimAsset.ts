/**
 * `claim_asset` — the mirror (off-chain `step`), paired with the core's
 * `claimAssetToPtb`. Terminal: `step` returns no successor state. It settles
 * pending first, requires a Retired escrow, then reads the asset id.
 */
import { claimAssetToPtb, type ClaimAssetPtbArgs, type ClaimResult } from '../../actions/claimAsset.js';
import type { TerminalAction } from '../../primitives/action.js';
import type { Ms } from '../../primitives/brand.js';
import type { AssetSchema, EscrowState } from '../../primitives/state.js';
import { assetId } from '../../views/identity.js';
import { applyPendingTransitionStates } from './apply.js';

export type { ClaimAssetPtbArgs, ClaimResult };

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
    toPtb: claimAssetToPtb(),
  };
}
