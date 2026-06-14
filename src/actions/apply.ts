/**
 * `apply_pending_transition_states` — the lazy-settlement Transition action.
 * `step` mirrors `asset_state::execute_apply_pending_transition_states`:
 * step_handover → step_tenure_expiry → step_auction_expiry, each firing only
 * when its boundary is crossed.
 *
 * The handover settlement is the one curve-driven transition: the resulting
 * *state* is structural (pending seat → active, schedule rescaled by the
 * tenure ratio), while the *economic split* (used credit, governor share,
 * fee, departing refund, new rent price) comes from the deterministic curve
 * math in `src/sim/curve.ts` and is reported in `result.settlement`.
 */
import { applyPendingTransitionStates as applyCall } from '../codegen/usufruct/escrow.js';
import type { Id, Mist } from '../primitives/brand.js';
import { mist } from '../primitives/brand.js';
import type { TransitionAction } from '../primitives/action.js';
import type { AssetSchema, EscrowState } from '../primitives/state.js';
import type { PackageIds } from '../config/network.js';
import { collapseCurveShape } from '../views/config.js';
import {
  ascendingFloor,
  rescaledDuration,
  splitFee,
  stakePerTenure,
  usedCredit,
} from '../sim/curve.js';
import { resolveCycleParams } from './internal.js';

export interface ApplyPtbArgs {
  readonly pkg: Pick<PackageIds, 'packageId'>;
  readonly escrowId: Id<'Escrow'>;
  readonly typeArguments: [string, string];
}

export type AppliedTransition = 'handover' | 'tenureExpiry' | 'auctionExpiry' | 'retire';

/** Economic split of a handover settlement (curve-derived). */
export interface HandoverSettlement {
  readonly usedMist: Mist;
  readonly governorShareMist: Mist;
  readonly feeMist: Mist;
  /** Departing usufructuary's refund (unused credit). */
  readonly refundMist: Mist;
  /** New rent price seeding the incoming tenancy. */
  readonly newRentPriceMist: Mist;
}

/**
 * Economic split of a tenure-expiry settlement. Unlike a handover (partial,
 * curve-derived, with a refund), a tenure that runs its full committed term
 * consumes the **entire** stake — no refund, no reprice — so `do_tenure_expiry`
 * settles `splitFee(principal)`. Mirrors the `tenureSettlement` on-chain view.
 */
export interface TenureSettlement {
  /** Consumed credit = the full active stake. */
  readonly usedMist: Mist;
  readonly governorShareMist: Mist;
  readonly feeMist: Mist;
}

export interface ApplyResult {
  readonly transitions: readonly AppliedTransition[];
  /** Present iff a handover fired (partial, curve-derived). */
  readonly settlement?: HandoverSettlement;
  /** Present iff a tenure expiry fired (full stake, no refund). */
  readonly tenureSettlement?: TenureSettlement;
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
      let settlement: HandoverSettlement | undefined;
      let tenureSettlement: TenureSettlement | undefined;

      // step_handover (Demand → Occupied at the bid's handover expiry). The
      // state swap is structural; the split is the credit curve at `expiry`.
      if (current.$kind === 'Renting' && current.Renting.$kind === 'Demand') {
        const d = current.Renting.Demand;
        const expiry = BigInt(d.bid.handover.expiry.ms);
        if (t >= expiry) {
          transitions.push('handover');
          const sched = d.terms.schedule;
          const principal = BigInt(d.terms.active.stake.balance.value);
          const committed = BigInt(sched.committed_tenures.count);
          const incoming = BigInt(d.bid.handover.tenures.count);
          const pendingStake = BigInt(d.bid.pending.stake.balance.value);

          // capped_used_credit(active stake, phase_start, expiry, credit_shape, ceiling).
          const used = usedCredit({
            stakeMist: principal,
            phaseStartMs: BigInt(sched.phase_start.ms),
            creditShape: collapseCurveShape(core.ensemble.active.credit_shape),
            ceilingMs: BigInt(sched.ceiling_total.ms),
            nowMs: expiry,
          });
          const { governorShare, fee } = splitFee(used);
          const esc = core.ensemble.active.price_escalation;
          const perTenure = stakePerTenure(pendingStake, incoming);
          const newRentPrice =
            esc.$kind === 'FixedDelta'
              ? ascendingFloor({ kind: 'fixedDelta', deltaMist: mist(esc.FixedDelta.delta.mist) }, perTenure)
              : ascendingFloor(
                  {
                    kind: 'compoundDelta',
                    bps: BigInt(esc.CompoundDelta.bps.bps) as never,
                    deltaMist: mist(esc.CompoundDelta.delta.mist),
                  },
                  perTenure,
                );
          settlement = {
            usedMist: mist(used),
            governorShareMist: mist(governorShare),
            feeMist: mist(fee),
            refundMist: mist(principal - used),
            newRentPriceMist: mist(newRentPrice),
          };

          current = {
            $kind: 'Renting',
            Renting: {
              $kind: 'Occupied',
              Occupied: {
                asset: d.asset,
                terms: {
                  schedule: {
                    phase_start: { ms: String(expiry) },
                    ceiling_total: {
                      ms: String(rescaledDuration(BigInt(sched.ceiling_total.ms), committed, incoming)),
                    },
                    handover_total: {
                      ms: String(rescaledDuration(BigInt(sched.handover_total.ms), committed, incoming)),
                    },
                    committed_tenures: { count: String(incoming) },
                  },
                  active: d.bid.pending,
                  retire: d.terms.retire,
                },
                cycle: d.cycle,
              },
            },
          } as AssetStateData;
        }
      }

      // step_tenure_expiry: Occupied past phase_start + ceiling_total.
      if (current.$kind === 'Renting' && current.Renting.$kind === 'Occupied') {
        const { asset, terms, cycle } = current.Renting.Occupied;
        const boundary =
          BigInt(terms.schedule.phase_start.ms) + BigInt(terms.schedule.ceiling_total.ms);
        if (t >= boundary) {
          const locked = { asset: asset.available };
          // The full committed stake is consumed and settled — no curve, no
          // refund (cf. handover). This happens *before* the retire decision,
          // so both the Retired and the Descent path settle. `splitFee` mirrors
          // `do_tenure_expiry` and the `tenureSettlement` view.
          transitions.push('tenureExpiry');
          const principal = BigInt(terms.active.stake.balance.value);
          const split = splitFee(principal);
          tenureSettlement = {
            usedMist: mist(principal),
            governorShareMist: mist(split.governorShare),
            feeMist: mist(split.fee),
          };
          if (terms.retire.$kind === 'Retiring') {
            transitions.push('retire');
            ensembleSlot = { ...ensembleSlot, pending: null };
            current = {
              $kind: 'Waiting',
              Waiting: { $kind: 'Retired', Retired: { asset: locked } },
            } as AssetStateData;
          } else {
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
      const result: ApplyResult = {
        transitions,
        ...(settlement ? { settlement } : {}),
        ...(tenureSettlement ? { tenureSettlement } : {}),
      };
      return { state: next, result };
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
