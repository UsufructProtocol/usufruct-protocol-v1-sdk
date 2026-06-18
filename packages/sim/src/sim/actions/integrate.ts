/**
 * `integrate` — the mirror (off-chain `step`), paired with the core's
 * `integrateToPtb`. `step` constructs the initial Idle `EscrowState` exactly as
 * `asset_state::build_idle_core_and_state` does. `ensembleConfigToData` (the
 * config → decoded-data mirror) lives here too — it backs `integrate.step` and
 * `governance` updates.
 */
import {
  integrateToPtb,
  integrateIntoPortfolioToPtb,
  type IntegrateParams,
  type IntegratePtbArgs,
  type IntegrateIntoPortfolioPtbArgs,
} from '@usufruct-protocol/sdk/actions/integrate.js';
import type { OriginAction } from '@usufruct-protocol/sdk/primitives/action.js';
import { id } from '@usufruct-protocol/sdk/primitives/brand.js';
import type { EscrowState } from '../../primitives/state.js';
import type { EnsembleConfig } from '@usufruct-protocol/sdk/config/ensemble.js';
import type { EnsembleData } from '../../types/state-views.js';
import { resolveCycleParams } from '../../views/internal.js';

export type { IntegrateParams, IntegratePtbArgs, IntegrateIntoPortfolioPtbArgs };

const ZERO = '0x' + '00'.repeat(32);

/** Mirror an `EnsembleConfig` into the parsed (BCS-decoded) data shape. */
export function ensembleConfigToData(cfg: EnsembleConfig): EnsembleData {
  const shape = (s: NonNullable<EnsembleConfig['creditShape']>) => {
    switch (s.kind) {
      case 'linear':
        return { $kind: 'Linear', Linear: true } as const;
      case 'smoothstep':
        return { $kind: 'Smoothstep', Smoothstep: true } as const;
      case 'logistic':
        return { $kind: 'Logistic', Logistic: true } as const;
      case 'powerLaw':
        return {
          $kind: 'PowerLaw',
          PowerLaw: { alpha_num: s.alphaNum, alpha_den: s.alphaDen },
        } as const;
      case 'exponential':
        return {
          $kind: 'Exponential',
          Exponential: { alpha_abs: s.alphaAbs, alpha_neg: s.alphaNeg },
        } as const;
    }
  };
  const handover = cfg.handover ?? { kind: 'off' };
  const descent = cfg.descent ?? { kind: 'off' };
  const escalation = cfg.escalation ?? { kind: 'fixedDelta', deltaMist: 1n };
  return {
    rest_price: { $kind: 'Fixed', Fixed: { price: { mist: String(cfg.restPrice) } } },
    tenure_duration: { $kind: 'Fixed', Fixed: { ceiling: { ms: String(cfg.tenureMs) } } },
    tenure_extend: cfg.multiTenure
      ? { $kind: 'Multi', Multi: true }
      : { $kind: 'Single', Single: true },
    handover:
      handover.kind === 'off'
        ? { $kind: 'Off', Off: true }
        : handover.kind === 'fullTenure'
          ? { $kind: 'FullTenure', FullTenure: true }
          : { $kind: 'Fixed', Fixed: { floor: { ms: String(handover.floorMs) } } },
    auction_window:
      descent.kind === 'off'
        ? { $kind: 'Off', Off: true }
        : { $kind: 'Fixed', Fixed: { ceiling: { ms: String(descent.ceilingMs) } } },
    credit_shape: shape(cfg.creditShape ?? { kind: 'linear' }),
    auction_shape: shape(cfg.auctionShape ?? { kind: 'linear' }),
    price_escalation:
      escalation.kind === 'fixedDelta'
        ? {
            $kind: 'FixedDelta',
            FixedDelta: { delta: { mist: String(escalation.deltaMist) } },
          }
        : {
            $kind: 'CompoundDelta',
            CompoundDelta: {
              bps: { bps: String(escalation.bps) },
              delta: { mist: String(escalation.deltaMist) },
            },
          },
  } as EnsembleData;
}

export function integrate(
  params: IntegrateParams,
): OriginAction<null, IntegratePtbArgs, EscrowState> {
  return {
    step: (t) => {
      const ids = params.identities ?? {};
      const ensemble = ensembleConfigToData(params.ensemble);
      const cycle = resolveCycleParams(ensemble);
      const anchor = { ms: String(t) };
      const state: EscrowState = {
        objectId: id<'Escrow'>(ids.escrowId ?? ZERO),
        assetType: params.assetType,
        coinType: params.coinType,
        escrow: {
          id: ids.escrowId ?? ZERO,
          core: {
            governor_seat: {
              identity: { cap_identity: { id: ids.governanceCapId ?? ZERO } },
              inbox: { id: ids.earningsInboxId ?? ZERO },
            },
            ensemble: { active: ensemble, pending: null },
            fee_inbox_identity: { id: ids.feeInboxId ?? ZERO },
            integrated_at: anchor,
            retire_commitment: {
              policy:
                (params.retireCommitment ?? { kind: 'immediate' }).kind === 'immediate'
                  ? { $kind: 'Immediate', Immediate: true }
                  : {
                      $kind: 'Deferred',
                      Deferred: {
                        floor: {
                          ms: String(
                            (params.retireCommitment as { floorMs: bigint }).floorMs,
                          ),
                        },
                      },
                    },
              anchor,
            },
            ensemble_commitment: {
              policy:
                (params.ensembleCommitment ?? { kind: 'immediate' }).kind === 'immediate'
                  ? { $kind: 'Immediate', Immediate: true }
                  : {
                      $kind: 'Deferred',
                      Deferred: {
                        floor: {
                          ms: String(
                            (params.ensembleCommitment as { floorMs: bigint }).floorMs,
                          ),
                        },
                      },
                    },
              anchor,
            },
            escrow_identity: { id: ids.escrowId ?? ZERO },
          },
          state: {
            $kind: 'Waiting',
            Waiting: {
              $kind: 'Idle',
              Idle: { asset: { asset: { id: ids.assetId ?? ZERO } }, cycle },
            },
          },
        } as EscrowState['escrow'],
      };
      return { state, result: null };
    },

    toPtb: integrateToPtb(params),
  };
}

/**
 * `integrate_into_portfolio` — Origin variant that attaches the new escrow to
 * an existing governance cap + earnings inbox (fleet). `step` mirrors
 * `integrate.step` except the identities come from the portfolio.
 */
export function integrateIntoPortfolio(
  params: IntegrateParams,
): OriginAction<null, IntegrateIntoPortfolioPtbArgs, EscrowState> {
  const base = integrate(params);
  return {
    step: base.step,
    toPtb: integrateIntoPortfolioToPtb(params),
  };
}
