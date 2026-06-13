/**
 * Governance and cap-holder actions: commitment extensions, ensemble
 * updates, refund-address updates, stale-cap burning, and the cap.move
 * consumers. All `step`s settle pending transitions first, mirroring the
 * engine's `execute_*` prologue.
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
import type { TransitionAction } from '../primitives/action.js';
import type { Id, Ms } from '../primitives/brand.js';
import type { EscrowState } from '../primitives/state.js';
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
import { resolveCycleParams } from '../views/internal.js';
import { applyPendingTransitionStates } from './apply.js';
import { ensembleConfigToData } from './integrate.js';

type State = EscrowState;
type Core = NonNullable<State['escrow']['core']>;
type CommitmentSlot = Core['retire_commitment'];
type AssetStateData = NonNullable<State['escrow']['state']>;

export interface GovernancePtbArgs {
  readonly pkg: PackageIds;
  readonly escrowId: Id<'Escrow'>;
  readonly governanceCapId: Id<'GovernanceCap'>;
  readonly typeArguments: [string, string];
}

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
): TransitionAction<null, GovernancePtbArgs> {
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
    toPtb: (tx, args) =>
      tx.add(
        extendRetireCall({
          package: args.pkg.packageId,
          arguments: [
            args.escrowId,
            args.governanceCapId,
            retireCommitmentToPtb(tx, args.pkg, cfg),
          ],
          typeArguments: args.typeArguments,
        }),
      ),
  };
}

export function extendEnsembleCommitment(
  cfg: EnsembleCommitmentConfig,
): TransitionAction<null, GovernancePtbArgs> {
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
    toPtb: (tx, args) =>
      tx.add(
        extendEnsembleCall({
          package: args.pkg.packageId,
          arguments: [
            args.escrowId,
            args.governanceCapId,
            ensembleCommitmentToPtb(tx, args.pkg, cfg),
          ],
          typeArguments: args.typeArguments,
        }),
      ),
  };
}

export type UpdateEnsembleResult = { readonly applied: 'immediate' | 'scheduled' };

export function updateEnsemble(
  cfg: EnsembleConfig,
): TransitionAction<UpdateEnsembleResult, GovernancePtbArgs> {
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
    toPtb: (tx, args) =>
      tx.add(
        updateEnsembleCall({
          package: args.pkg.packageId,
          arguments: [
            args.escrowId,
            args.governanceCapId,
            ensembleToPtb(tx, args.pkg, cfg),
          ],
          typeArguments: args.typeArguments,
        }),
      ),
  };
}

export interface CapHolderPtbArgs {
  readonly pkg: Pick<PackageIds, 'packageId'>;
  readonly escrowId: Id<'Escrow'>;
  readonly usufructCapId: string;
  readonly typeArguments: [string, string];
}

export function updateUsufructuaryRefundAddress(params: {
  readonly usufructCapId: string;
  readonly newAddress: string;
}): TransitionAction<null, CapHolderPtbArgs> {
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
    toPtb: (tx, args) =>
      tx.add(
        updateRefundCall({
          package: args.pkg.packageId,
          arguments: [
            args.escrowId,
            args.usufructCapId,
            tx.add(
              refundAddressCall({
                package: args.pkg.packageId,
                arguments: [params.newAddress],
              }),
            ),
          ],
          typeArguments: args.typeArguments,
        }),
      ),
  };
}

export function burnStaleUsufructCap(params: {
  readonly usufructCapId: string;
}): TransitionAction<null, CapHolderPtbArgs> {
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
    toPtb: (tx, args) =>
      tx.add(
        burnStaleCall({
          package: args.pkg.packageId,
          arguments: [args.escrowId, args.usufructCapId],
          typeArguments: args.typeArguments,
        }),
      ),
  };
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
