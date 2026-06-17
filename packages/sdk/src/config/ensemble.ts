/**
 * DSL config builder (SPEC §7, "DSL config builder"): `EnsembleConfig` is a
 * pure data record; `ensembleToPtb` is its PTB interpretation, emitting the
 * nested `ensemble::new_*` constructor calls.
 */
import type { Transaction, TransactionResult } from '@mysten/sui/transactions';
import * as e from '../codegen/usufruct/ensemble.js';
import type { Bps, Mist, Ms } from '../primitives/brand.js';
import type { PackageIds } from './network.js';

export type ShapeConfig =
  | { readonly kind: 'linear' }
  | { readonly kind: 'smoothstep' }
  | { readonly kind: 'logistic' }
  | { readonly kind: 'powerLaw'; readonly alphaNum: number; readonly alphaDen: number }
  | { readonly kind: 'exponential'; readonly alphaAbs: number; readonly alphaNeg: boolean };

export interface EnsembleConfig {
  /** Per-tenure rest price in mist. */
  readonly restPrice: Mist;
  /** Tenure duration ceiling in ms. */
  readonly tenureMs: Ms;
  /** Allow multi-tenure commitments. Default false (single). */
  readonly multiTenure?: boolean;
  readonly handover?: { readonly kind: 'off' } | { readonly kind: 'fullTenure' } | { readonly kind: 'fixed'; readonly floorMs: Ms };
  readonly descent?: { readonly kind: 'off' } | { readonly kind: 'fixed'; readonly ceilingMs: Ms };
  readonly creditShape?: ShapeConfig;
  readonly auctionShape?: ShapeConfig;
  readonly escalation?:
    | { readonly kind: 'fixedDelta'; readonly deltaMist: Mist }
    | { readonly kind: 'compoundDelta'; readonly bps: Bps; readonly deltaMist: Mist };
}

export type RetireCommitmentConfig =
  | { readonly kind: 'immediate' }
  | { readonly kind: 'deferred'; readonly floorMs: Ms };

export type EnsembleCommitmentConfig = RetireCommitmentConfig;

type Pkg = Pick<PackageIds, 'packageId'>;

function shapeToPtb(tx: Transaction, pkg: Pkg, s: ShapeConfig): TransactionResult {
  const p = pkg.packageId;
  switch (s.kind) {
    case 'linear':
      return tx.add(e.newLinear({ package: p }));
    case 'smoothstep':
      return tx.add(e.newSmoothstep({ package: p }));
    case 'logistic':
      return tx.add(e.newLogistic({ package: p }));
    case 'powerLaw':
      return tx.add(e.newPowerLaw({ package: p, arguments: [s.alphaNum, s.alphaDen] }));
    case 'exponential':
      return tx.add(e.newExponential({ package: p, arguments: [s.alphaAbs, s.alphaNeg] }));
  }
}

/** Emit the `PolicyEnsemble` constructor chain; returns the ensemble value. */
export function ensembleToPtb(
  tx: Transaction,
  pkg: Pkg,
  cfg: EnsembleConfig,
): TransactionResult {
  const p = pkg.packageId;
  const price = (m: Mist) => tx.add(e.price({ package: p, arguments: [m] }));
  const dur = (m: Ms) => tx.add(e.duration({ package: p, arguments: [m] }));

  const restPrice = tx.add(
    e.newRestPriceFixed({ package: p, arguments: [price(cfg.restPrice)] }),
  );
  const tenureDuration = tx.add(
    e.newTenureDurationFixed({ package: p, arguments: [dur(cfg.tenureMs)] }),
  );
  const tenureExtend = cfg.multiTenure
    ? tx.add(e.newTenureMulti({ package: p }))
    : tx.add(e.newTenureSingle({ package: p }));

  const handover = cfg.handover ?? { kind: 'off' };
  const handoverArg =
    handover.kind === 'off'
      ? tx.add(e.newHandoverOff({ package: p }))
      : handover.kind === 'fullTenure'
        ? tx.add(e.newHandoverFullTenure({ package: p }))
        : tx.add(e.newHandoverFixed({ package: p, arguments: [dur(handover.floorMs)] }));

  const descent = cfg.descent ?? { kind: 'off' };
  const auctionWindow =
    descent.kind === 'off'
      ? tx.add(e.newDescentOff({ package: p }))
      : tx.add(e.newDescentFixed({ package: p, arguments: [dur(descent.ceilingMs)] }));

  const creditShape = shapeToPtb(tx, pkg, cfg.creditShape ?? { kind: 'linear' });
  const auctionShape = shapeToPtb(tx, pkg, cfg.auctionShape ?? { kind: 'linear' });

  const escalation = cfg.escalation ?? { kind: 'fixedDelta', deltaMist: 1n as Mist };
  const escalationArg =
    escalation.kind === 'fixedDelta'
      ? tx.add(e.newPriceFixedDelta({ package: p, arguments: [price(escalation.deltaMist)] }))
      : tx.add(
          e.newPriceCompoundDelta({
            package: p,
            // BasisPoints has no public constructor; it is a single-u64 struct,
            // so its BCS layout is exactly a pure u64 (pattern proven live by
            // the audit harness).
            arguments: [tx.pure.u64(escalation.bps), price(escalation.deltaMist)],
          }),
        );

  return tx.add(
    e.newEnsemble({
      package: p,
      arguments: [
        restPrice,
        tenureDuration,
        tenureExtend,
        handoverArg,
        auctionWindow,
        creditShape,
        auctionShape,
        escalationArg,
      ],
    }),
  );
}

/** Emit a `RetireCommitmentPolicy` / `EnsembleCommitmentPolicy` value. */
export function retireCommitmentToPtb(
  tx: Transaction,
  pkg: Pkg,
  cfg: RetireCommitmentConfig = { kind: 'immediate' },
): TransactionResult {
  const p = pkg.packageId;
  if (cfg.kind === 'immediate') return tx.add(e.newRetireCommitmentImmediate({ package: p }));
  return tx.add(
    e.newRetireCommitmentDeferred({
      package: p,
      arguments: [tx.add(e.duration({ package: p, arguments: [cfg.floorMs] }))],
    }),
  );
}

export function ensembleCommitmentToPtb(
  tx: Transaction,
  pkg: Pkg,
  cfg: EnsembleCommitmentConfig = { kind: 'immediate' },
): TransactionResult {
  const p = pkg.packageId;
  if (cfg.kind === 'immediate') return tx.add(e.newEnsembleCommitmentImmediate({ package: p }));
  return tx.add(
    e.newEnsembleCommitmentDeferred({
      package: p,
      arguments: [tx.add(e.duration({ package: p, arguments: [cfg.floorMs] }))],
    }),
  );
}
