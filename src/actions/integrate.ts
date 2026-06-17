/**
 * `integrate` — the Origin action: wraps an asset into a new escrow.
 *
 * Core (drift-zero) surface: the PTB builders only. The off-chain `step` that
 * constructs the initial Idle `EscrowState`, plus the `ensembleConfigToData`
 * mirror it depends on, live in `sim/actions/integrate.ts`.
 */
import type { TransactionObjectArgument } from '@mysten/sui/transactions';
import {
  integrate as integrateCall,
  integrateIntoPortfolio as integrateIntoPortfolioCall,
} from '../codegen/usufruct/escrow.js';
import type { PtbAction } from '../primitives/action.js';
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

export interface IntegrateParams {
  readonly ensemble: EnsembleConfig;
  readonly retireCommitment?: RetireCommitmentConfig;
  readonly ensembleCommitment?: EnsembleCommitmentConfig;
  readonly assetType: string;
  readonly coinType: string;
  /** step-only: chain-assigned identities; zeroed placeholders when simulating. */
  readonly identities?: Partial<{
    escrowId: string;
    assetId: string;
    governanceCapId: string;
    earningsInboxId: string;
    feeInboxId: string;
  }>;
}

export interface IntegratePtbArgs {
  readonly pkg: PackageIds;
  /** The asset object to escrow (id or a result from a previous command). */
  readonly asset: string | TransactionObjectArgument;
  readonly typeArguments: [string, string];
}

export interface IntegrateIntoPortfolioPtbArgs extends IntegratePtbArgs {
  /** Existing portfolio: governance cap + earnings inbox to attach to. */
  readonly governanceCapId: string;
  readonly earningsInboxId: string;
}

/** Appends the `integrate` Move call. Returns `[escrow, governanceCap, …]`. */
export function integrateToPtb(params: IntegrateParams): PtbAction<IntegratePtbArgs>['toPtb'] {
  return (tx, args) =>
    tx.add(
      integrateCall({
        package: args.pkg.packageId,
        arguments: [
          typeof args.asset === 'string' ? tx.object(args.asset) : args.asset,
          ensembleToPtb(tx, args.pkg, params.ensemble),
          retireCommitmentToPtb(tx, args.pkg, params.retireCommitment),
          ensembleCommitmentToPtb(tx, args.pkg, params.ensembleCommitment),
          args.pkg.feeRefId,
        ],
        typeArguments: args.typeArguments,
      }),
    );
}

export function integrate(params: IntegrateParams): PtbAction<IntegratePtbArgs> {
  return { toPtb: integrateToPtb(params) };
}

/** Appends `integrate_into_portfolio` — attach to an existing cap + inbox. */
export function integrateIntoPortfolioToPtb(
  params: IntegrateParams,
): PtbAction<IntegrateIntoPortfolioPtbArgs>['toPtb'] {
  return (tx, args) =>
    tx.add(
      integrateIntoPortfolioCall({
        package: args.pkg.packageId,
        arguments: [
          typeof args.asset === 'string' ? tx.object(args.asset) : args.asset,
          ensembleToPtb(tx, args.pkg, params.ensemble),
          retireCommitmentToPtb(tx, args.pkg, params.retireCommitment),
          ensembleCommitmentToPtb(tx, args.pkg, params.ensembleCommitment),
          args.pkg.feeRefId,
          args.governanceCapId,
          args.earningsInboxId,
        ],
        typeArguments: args.typeArguments,
      }),
    );
}

export function integrateIntoPortfolio(
  params: IntegrateParams,
): PtbAction<IntegrateIntoPortfolioPtbArgs> {
  return { toPtb: integrateIntoPortfolioToPtb(params) };
}
