/**
 * Governance / cap-holder actions — the mirror (off-chain `step`s), paired with
 * the core's `*ToPtb` builders. Each `step` settles pending transitions first,
 * mirroring the engine's `execute_*` prologue. Re-exports the core's plain PTB
 * helpers (cap.move consumers) so `sim/actions` is a superset of core.
 */
import {
  extendRetireCommitmentToPtb,
  extendEnsembleCommitmentToPtb,
  updateEnsembleToPtb,
  updateUsufructuaryRefundAddressToPtb,
  burnStaleUsufructCapToPtb,
  renounceGovernanceToPtb,
  burnUsufructCapToPtb,
  type GovernancePtbArgs,
  type UpdateEnsembleResult,
  type CapHolderPtbArgs,
} from '@usufruct-protocol/sdk/actions/governance.js';
import type { TransitionAction } from '@usufruct-protocol/sdk/primitives/action.js';
import type { Ms } from '@usufruct-protocol/sdk/primitives/brand.js';
import type { EscrowState } from '../../primitives/state.js';
import type {
  EnsembleCommitmentConfig,
  EnsembleConfig,
  RetireCommitmentConfig,
} from '@usufruct-protocol/sdk/config/ensemble.js';
import { resolveCycleParams } from '../../views/internal.js';
import { applyPendingTransitionStates } from './apply.js';
import { ensembleConfigToData } from './integrate.js';

export { renounceGovernanceToPtb, burnUsufructCapToPtb };
export type { GovernancePtbArgs, UpdateEnsembleResult, CapHolderPtbArgs };

type State = EscrowState;
type Core = NonNullable<State['escrow']['core']>;
type CommitmentSlot = Core['retire_commitment'];
type AssetStateData = NonNullable<State['escrow']['state']>;

function settle(state: State, t: Ms): State {
  return applyPendingTransitionStates().step(state, t).state;
}

function assertNotRetired(s: AssetStateData | null): asserts s is AssetStateData {
  if (s == null) throw new Error('EAssetBorrowed');
  if (s.$kind === 'Waiting' && s.Waiting.$kind === 'Retired') {
    throw new Error('EAlreadyRetired');
  }
}

/** Mirrors the chained anchor semantics of `execute_extend_*_commitment`. */
function extendSlot(slot: CommitmentSlot, cfg: RetireCommitmentConfig): CommitmentSlot {
  if (cfg.kind !== 'deferred' || cfg.floorMs <= 0n) {
    throw new Error('ECommitmentNotExtended: new duration must be > 0');
  }
  const oldFloor = slot.policy.$kind === 'Immediate' ? 0n : BigInt(slot.policy.Deferred.floor.ms);
  const oldUnlock = BigInt(slot.anchor.ms) + oldFloor;
  return {
    policy: {
      $kind: 'Deferred',
      Deferred: { floor: { ms: String(cfg.floorMs) } },
    } as CommitmentSlot['policy'],
    anchor: { ms: String(oldUnlock) },
  };
}

export function extendRetireCommitment(
  cfg: RetireCommitmentConfig,
): TransitionAction<null, GovernancePtbArgs, State> {
  return {
    step: (state, t) => {
      const settled = settle(state, t);
      assertNotRetired(settled.escrow.state);
      const core = settled.escrow.core!;
      const next: State = {
        ...settled,
        escrow: {
          ...settled.escrow,
          core: { ...core, retire_commitment: extendSlot(core.retire_commitment, cfg) },
        },
      };
      return { state: next, result: null };
    },
    toPtb: extendRetireCommitmentToPtb(cfg),
  };
}

export function extendEnsembleCommitment(
  cfg: EnsembleCommitmentConfig,
): TransitionAction<null, GovernancePtbArgs, State> {
  return {
    step: (state, t) => {
      const settled = settle(state, t);
      assertNotRetired(settled.escrow.state);
      const core = settled.escrow.core!;
      const next: State = {
        ...settled,
        escrow: {
          ...settled.escrow,
          core: {
            ...core,
            ensemble_commitment: extendSlot(
              core.ensemble_commitment as CommitmentSlot,
              cfg,
            ) as Core['ensemble_commitment'],
          },
        },
      };
      return { state: next, result: null };
    },
    toPtb: extendEnsembleCommitmentToPtb(cfg),
  };
}

export function updateEnsemble(
  cfg: EnsembleConfig,
): TransitionAction<UpdateEnsembleResult, GovernancePtbArgs, State> {
  return {
    step: (state, t) => {
      // Guard order mirrors the engine: commitment check precedes settling.
      const core0 = state.escrow.core!;
      const slot = core0.ensemble_commitment as CommitmentSlot;
      const floor = slot.policy.$kind === 'Immediate' ? 0n : BigInt(slot.policy.Deferred.floor.ms);
      if (t < BigInt(slot.anchor.ms) + floor) {
        throw new Error('EEnsembleCommitmentFloorNotElapsed');
      }
      const settled = settle(state, t);
      assertNotRetired(settled.escrow.state);
      const s = settled.escrow.state;
      const core = settled.escrow.core!;
      const newEnsemble = ensembleConfigToData(cfg);

      if (s.$kind === 'Waiting' && s.Waiting.$kind === 'Idle') {
        // Immediate application: active ← new, cycle re-resolved.
        const cycle = resolveCycleParams(newEnsemble);
        const next: State = {
          ...settled,
          escrow: {
            ...settled.escrow,
            core: { ...core, ensemble: { active: newEnsemble, pending: null } },
            state: {
              $kind: 'Waiting',
              Waiting: { $kind: 'Idle', Idle: { ...s.Waiting.Idle, cycle } },
            } as AssetStateData,
          },
        };
        return { state: next, result: { applied: 'immediate' } };
      }

      if (s.$kind === 'Renting') {
        const terms = s.Renting.$kind === 'Occupied' ? s.Renting.Occupied.terms : s.Renting.Demand.terms;
        if (terms.retire.$kind === 'Retiring') throw new Error('ERetireAlreadyScheduled');
      }
      const next: State = {
        ...settled,
        escrow: {
          ...settled.escrow,
          core: { ...core, ensemble: { ...core.ensemble, pending: newEnsemble } },
        },
      };
      return { state: next, result: { applied: 'scheduled' } };
    },
    toPtb: updateEnsembleToPtb(cfg),
  };
}

export function updateUsufructuaryRefundAddress(params: {
  readonly usufructCapId: string;
  readonly newAddress: string;
}): TransitionAction<null, CapHolderPtbArgs, State> {
  return {
    step: (state, t) => {
      const settled = settle(state, t);
      const s = settled.escrow.state;
      if (s == null || s.$kind !== 'Renting') throw new Error('EUsufructCapStale');
      const r = s.Renting;
      const terms = r.$kind === 'Occupied' ? r.Occupied.terms : r.Demand.terms;
      const setSeatAddr = <T extends { identity: { address: { addr: string } } }>(seat: T): T => ({
        ...seat,
        identity: { ...seat.identity, address: { addr: params.newAddress } },
      });

      let renting: AssetStateData;
      if (terms.active.identity.cap_identity.id === params.usufructCapId) {
        const newTerms = { ...terms, active: setSeatAddr(terms.active) };
        renting =
          r.$kind === 'Occupied'
            ? ({ $kind: 'Renting', Renting: { ...r, Occupied: { ...r.Occupied, terms: newTerms } } } as AssetStateData)
            : ({ $kind: 'Renting', Renting: { ...r, Demand: { ...r.Demand, terms: newTerms } } } as AssetStateData);
      } else if (
        r.$kind === 'Demand' &&
        r.Demand.bid.pending.identity.cap_identity.id === params.usufructCapId
      ) {
        renting = {
          $kind: 'Renting',
          Renting: {
            ...r,
            Demand: {
              ...r.Demand,
              bid: { ...r.Demand.bid, pending: setSeatAddr(r.Demand.bid.pending) },
            },
          },
        } as AssetStateData;
      } else {
        throw new Error('EUsufructCapStale');
      }
      return {
        state: { ...settled, escrow: { ...settled.escrow, state: renting } },
        result: null,
      };
    },
    toPtb: updateUsufructuaryRefundAddressToPtb(params),
  };
}

export function burnStaleUsufructCap(params: {
  readonly usufructCapId: string;
}): TransitionAction<null, CapHolderPtbArgs, State> {
  return {
    step: (state, t) => {
      const settled = settle(state, t);
      const s = settled.escrow.state;
      if (s?.$kind === 'Renting') {
        const r = s.Renting;
        const terms = r.$kind === 'Occupied' ? r.Occupied.terms : r.Demand.terms;
        if (terms.active.identity.cap_identity.id === params.usufructCapId) {
          throw new Error('EUsufructCapNotStale');
        }
        if (
          r.$kind === 'Demand' &&
          r.Demand.bid.pending.identity.cap_identity.id === params.usufructCapId
        ) {
          throw new Error('EUsufructCapNotStale');
        }
      }
      // The cap is consumed off-chain conceptually; escrow state unchanged.
      return { state: settled, result: null };
    },
    toPtb: burnStaleUsufructCapToPtb(params),
  };
}
