/**
 * Governance and cap-holder actions: commitment extensions, ensemble updates,
 * refund-address updates, stale-cap burning, and the cap.move consumers.
 *
 * Core (drift-zero) surface: the PTB builders only. The off-chain `step`s (each
 * settling pending transitions first, mirroring the engine's `execute_*`
 * prologue) live in the mirror (`sim/actions/governance.ts`), which pairs them
 * with the `*ToPtb` builders here.
 */
import type { Transaction, TransactionResult } from '@mysten/sui/transactions';
import { renounceGovernance as renounceCall, burnUsufructCap as burnCapCall } from '../codegen/usufruct/cap.js';
import {
  burnStaleUsufructCap as burnStaleCall,
  extendEnsembleCommitment as extendEnsembleCall,
  extendRetireCommitment as extendRetireCall,
  updateEnsemble as updateEnsembleCall,
  updateUsufructuaryRefundAddress as updateRefundCall,
} from '../codegen/usufruct/escrow.js';
import { refundAddress as refundAddressCall } from '../codegen/usufruct/refund.js';
import type { PtbAction } from '../primitives/action.js';
import type { Id } from '../primitives/brand.js';
import type {
  EnsembleCommitmentConfig,
  EnsembleConfig,
  RetireCommitmentConfig,
} from '../config/ensemble.js';
import {
  ensembleCommitmentToPtb,
  ensembleToPtb,
  retireCommitmentToPtb,
} from '../config/ensemble.js';
import type { PackageIds } from '../config/network.js';

export interface GovernancePtbArgs {
  readonly pkg: PackageIds;
  readonly escrowId: Id<'Escrow'>;
  readonly governanceCapId: Id<'GovernanceCap'>;
  readonly typeArguments: [string, string];
}

export type UpdateEnsembleResult = { readonly applied: 'immediate' | 'scheduled' };

export function extendRetireCommitmentToPtb(
  cfg: RetireCommitmentConfig,
): PtbAction<GovernancePtbArgs>['toPtb'] {
  return (tx, args) =>
    tx.add(
      extendRetireCall({
        package: args.pkg.packageId,
        arguments: [args.escrowId, args.governanceCapId, retireCommitmentToPtb(tx, args.pkg, cfg)],
        typeArguments: args.typeArguments,
      }),
    );
}

export function extendRetireCommitment(
  cfg: RetireCommitmentConfig,
): PtbAction<GovernancePtbArgs> {
  return { toPtb: extendRetireCommitmentToPtb(cfg) };
}

export function extendEnsembleCommitmentToPtb(
  cfg: EnsembleCommitmentConfig,
): PtbAction<GovernancePtbArgs>['toPtb'] {
  return (tx, args) =>
    tx.add(
      extendEnsembleCall({
        package: args.pkg.packageId,
        arguments: [args.escrowId, args.governanceCapId, ensembleCommitmentToPtb(tx, args.pkg, cfg)],
        typeArguments: args.typeArguments,
      }),
    );
}

export function extendEnsembleCommitment(
  cfg: EnsembleCommitmentConfig,
): PtbAction<GovernancePtbArgs> {
  return { toPtb: extendEnsembleCommitmentToPtb(cfg) };
}

export function updateEnsembleToPtb(
  cfg: EnsembleConfig,
): PtbAction<GovernancePtbArgs>['toPtb'] {
  return (tx, args) =>
    tx.add(
      updateEnsembleCall({
        package: args.pkg.packageId,
        arguments: [args.escrowId, args.governanceCapId, ensembleToPtb(tx, args.pkg, cfg)],
        typeArguments: args.typeArguments,
      }),
    );
}

export function updateEnsemble(cfg: EnsembleConfig): PtbAction<GovernancePtbArgs> {
  return { toPtb: updateEnsembleToPtb(cfg) };
}

export interface CapHolderPtbArgs {
  readonly pkg: Pick<PackageIds, 'packageId'>;
  readonly escrowId: Id<'Escrow'>;
  readonly usufructCapId: string;
  readonly typeArguments: [string, string];
}

export function updateUsufructuaryRefundAddressToPtb(params: {
  readonly usufructCapId: string;
  readonly newAddress: string;
}): PtbAction<CapHolderPtbArgs>['toPtb'] {
  return (tx, args) =>
    tx.add(
      updateRefundCall({
        package: args.pkg.packageId,
        arguments: [
          args.escrowId,
          args.usufructCapId,
          tx.add(
            refundAddressCall({ package: args.pkg.packageId, arguments: [params.newAddress] }),
          ),
        ],
        typeArguments: args.typeArguments,
      }),
    );
}

export function updateUsufructuaryRefundAddress(params: {
  readonly usufructCapId: string;
  readonly newAddress: string;
}): PtbAction<CapHolderPtbArgs> {
  return { toPtb: updateUsufructuaryRefundAddressToPtb(params) };
}

export function burnStaleUsufructCapToPtb(_params: {
  readonly usufructCapId: string;
}): PtbAction<CapHolderPtbArgs>['toPtb'] {
  return (tx, args) =>
    tx.add(
      burnStaleCall({
        package: args.pkg.packageId,
        arguments: [args.escrowId, args.usufructCapId],
        typeArguments: args.typeArguments,
      }),
    );
}

export function burnStaleUsufructCap(params: {
  readonly usufructCapId: string;
}): PtbAction<CapHolderPtbArgs> {
  return { toPtb: burnStaleUsufructCapToPtb(params) };
}

// ── cap.move consumers — they act on the cap object, not on any EscrowState
// aggregate, so they are plain PTB helpers rather than lifecycle variants. ──

export function renounceGovernanceToPtb(
  tx: Transaction,
  args: { pkg: Pick<PackageIds, 'packageId'>; governanceCapId: string },
): TransactionResult {
  return tx.add(
    renounceCall({ package: args.pkg.packageId, arguments: [args.governanceCapId] }),
  );
}

export function burnUsufructCapToPtb(
  tx: Transaction,
  args: { pkg: Pick<PackageIds, 'packageId'>; usufructCapId: string },
): TransactionResult {
  return tx.add(
    burnCapCall({ package: args.pkg.packageId, arguments: [args.usufructCapId] }),
  );
}
