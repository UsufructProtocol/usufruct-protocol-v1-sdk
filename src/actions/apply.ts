/**
 * `apply_pending_transition_states` — the lazy-settlement Transition action.
 * `step` mirrors `asset_state::execute_apply_pending_transition_states`:
 * step_handover → step_tenure_expiry → step_auction_expiry, each firing only
 * when its boundary is crossed.
 *
 * Prototype scope: deterministic configs without a pending handover (Demand
 * settlement needs curve math — Pattern A territory until golden-tested).
 */
import { applyPendingTransitionStates as applyCall } from '../codegen/usufruct/escrow.js';
import type { Id } from '../primitives/brand.js';
import type { TransitionAction } from '../primitives/action.js';
import { NotImplementedStepError } from '../primitives/action.js';
import type { AssetSchema, EscrowState } from '../primitives/state.js';
import type { PackageIds } from '../config/network.js';
import { resolveCycleParams } from './internal.js';

export interface ApplyPtbArgs {
  readonly pkg: Pick<PackageIds, 'packageId'>;
  readonly escrowId: Id<'Escrow'>;
  readonly typeArguments: [string, string];
}

export type AppliedTransition = 'tenureExpiry' | 'auctionExpiry' | 'retire';

export interface ApplyResult {
  readonly transitions: readonly AppliedTransition[];
}

type State = EscrowState<AssetSchema>;
type AssetStateData = NonNullable<State['escrow']['state']>;

export function applyPendingTransitionStates(): TransitionAction<ApplyResult, ApplyPtbArgs> {
  return {
    step: (state: State, t) => {
      const s = state.escrow.state;
      if (s == null) throw new Error('EAssetBorrowed: asset state slot is empty');
      const core = state.escrow.core;
      if (core == null) throw new Error('Escrow core slot is empty');

      const transitions: AppliedTransition[] = [];
      let current: AssetStateData = s;
      let ensembleSlot = core.ensemble;

      // step_handover — out of prototype scope when firable (settlement math).
      if (current.$kind === 'Renting' && current.Renting.$kind === 'Demand') {
        const expiry = BigInt(current.Renting.Demand.bid.handover.expiry.ms);
        if (t >= expiry) {
          throw new NotImplementedStepError('applyPendingTransitionStates[handover]');
        }
      }

      // step_tenure_expiry: Occupied past phase_start + ceiling_total.
      if (current.$kind === 'Renting' && current.Renting.$kind === 'Occupied') {
        const { asset, terms, cycle } = current.Renting.Occupied;
        const boundary =
          BigInt(terms.schedule.phase_start.ms) + BigInt(terms.schedule.ceiling_total.ms);
        if (t >= boundary) {
          const locked = { asset: asset.available };
          if (terms.retire.$kind === 'Retiring') {
            transitions.push('tenureExpiry', 'retire');
            ensembleSlot = { ...ensembleSlot, pending: null };
            current = {
              $kind: 'Waiting',
              Waiting: { $kind: 'Retired', Retired: { asset: locked } },
            } as AssetStateData;
          } else {
            transitions.push('tenureExpiry');
            const principal = BigInt(terms.active.stake.balance.value);
            const count = BigInt(terms.schedule.committed_tenures.count);
            current = {
              $kind: 'Waiting',
              Waiting: {
                $kind: 'Descent',
                Descent: {
                  asset: locked,
                  auction: {
                    last_acq_price: { mist: String(principal / count) },
                    phase_start: { ms: String(boundary) },
                  },
                  cycle,
                },
              },
            } as AssetStateData;
          }
        }
      }

      // step_auction_expiry: Descent past phase_start + cycle.descent.
      if (current.$kind === 'Waiting' && current.Waiting.$kind === 'Descent') {
        const { asset, auction, cycle } = current.Waiting.Descent;
        const boundary = BigInt(auction.phase_start.ms) + BigInt(cycle.descent.ms);
        if (t >= boundary) {
          transitions.push('auctionExpiry');
          let nextCycle = cycle;
          if (ensembleSlot.pending != null) {
            const pending = ensembleSlot.pending;
            ensembleSlot = { active: pending, pending: null };
            nextCycle = resolveCycleParams(pending);
          }
          current = {
            $kind: 'Waiting',
            Waiting: { $kind: 'Idle', Idle: { asset, cycle: nextCycle } },
          } as AssetStateData;
        }
      }

      const next: State = {
        ...state,
        escrow: { ...state.escrow, core: { ...core, ensemble: ensembleSlot }, state: current },
      };
      return { state: next, result: { transitions } };
    },

    toPtb: (tx, args) =>
      tx.add(
        applyCall({
          package: args.pkg.packageId,
          arguments: [args.escrowId],
          typeArguments: args.typeArguments,
        }),
      ),
  };
}
