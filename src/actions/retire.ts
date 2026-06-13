/**
 * `retire` — Transition action: the governor signals retirement. Resolved
 * lazily by the engine — immediate when Waiting (Idle/Descent → Retired),
 * a flag (`NotRetiring → Retiring`) when rented, applied at the next tenure
 * boundary. Pure state machine; no curve. `step` mirrors `execute_retire`.
 */
import { retire as retireCall } from '../codegen/usufruct/escrow.js';
import type { TransitionAction } from '../primitives/action.js';
import type { Id, Ms } from '../primitives/brand.js';
import type { AssetSchema, EscrowState } from '../primitives/state.js';
import type { PackageIds } from '../config/network.js';
import { applyPendingTransitionStates } from './apply.js';

export interface RetirePtbArgs {
  readonly pkg: Pick<PackageIds, 'packageId'>;
  readonly escrowId: Id<'Escrow'>;
  readonly governanceCapId: Id<'GovernanceCap'>;
  readonly typeArguments: [string, string];
}

type State = EscrowState<AssetSchema>;
type AssetStateData = NonNullable<State['escrow']['state']>;

/** `retire_condition_set` on the renting terms (NotRetiring → Retiring). */
function withRetiring<T extends { terms: { retire: { $kind: string } } }>(renting: T): T {
  if (renting.terms.retire.$kind === 'Retiring') throw new Error('EAlreadyRetiring');
  return {
    ...renting,
    terms: { ...renting.terms, retire: { $kind: 'Retiring', Retiring: true } },
  };
}

export function retire(): TransitionAction<null, RetirePtbArgs> {
  return {
    step: (state: State, t: Ms) => {
      const settled = applyPendingTransitionStates().step(state, t).state;
      const s = settled.escrow.state;
      const core = settled.escrow.core;
      if (s == null || core == null) throw new Error('EAssetBorrowed');

      // Guard: retire commitment must have elapsed.
      const slot = core.retire_commitment;
      const floor =
        slot.policy.$kind === 'Immediate' ? 0n : BigInt(slot.policy.Deferred.floor.ms);
      if (t < BigInt(slot.anchor.ms) + floor) throw new Error('ERetireCommitmentFloorNotElapsed');

      let next: AssetStateData;
      if (s.$kind === 'Waiting') {
        if (s.Waiting.$kind === 'Retired') throw new Error('EAlreadyRetired');
        // Idle / Descent → immediate Retired, carrying the locked custody.
        const asset = s.Waiting.$kind === 'Idle' ? s.Waiting.Idle.asset : s.Waiting.Descent.asset;
        next = { $kind: 'Waiting', Waiting: { $kind: 'Retired', Retired: { asset } } } as AssetStateData;
      } else if (s.Renting.$kind === 'Occupied') {
        next = {
          $kind: 'Renting',
          Renting: { $kind: 'Occupied', Occupied: withRetiring(s.Renting.Occupied) },
        } as AssetStateData;
      } else {
        next = {
          $kind: 'Renting',
          Renting: { $kind: 'Demand', Demand: withRetiring(s.Renting.Demand) },
        } as AssetStateData;
      }

      return {
        state: {
          ...settled,
          escrow: {
            ...settled.escrow,
            core: { ...core, ensemble: { ...core.ensemble, pending: null } },
            state: next,
          },
        },
        result: null,
      };
    },
    toPtb: (tx, args) =>
      tx.add(
        retireCall({
          package: args.pkg.packageId,
          arguments: [args.escrowId, args.governanceCapId],
          typeArguments: args.typeArguments,
        }),
      ),
  };
}
