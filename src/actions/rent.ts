/**
 * `rent` — Transition action: acquire (install) or bid for the right of use.
 *
 * `step` computes the curve-derived floor the chain would charge (descending
 * Dutch-auction floor in Descent, ascending escalation floor for a bid),
 * validates the payment, and assembles the successor state — `Occupied`
 * (install from Idle/Descent), `Demand` (bid over Occupied), or a superseded
 * `Demand`. The floor is bit-exact; the freshly-minted `UsufructCap` id is
 * chain-assigned, so the new seat's `capId` is a caller-supplied placeholder
 * (same caveat as `integrate.step`). The floor is reported in `result`.
 */
import type { TransactionObjectArgument } from '@mysten/sui/transactions';
import { tenures as tenuresCall } from '../codegen/usufruct/ensemble.js';
import { rent as rentCall } from '../codegen/usufruct/escrow.js';
import type { TransitionAction } from '../primitives/action.js';
import type { Id, Mist, Ms, TenureCount } from '../primitives/brand.js';
import { mist } from '../primitives/brand.js';
import type { AssetSchema, EscrowState } from '../primitives/state.js';
import type { PackageIds } from '../config/network.js';
import { collapseCurveShape } from '../views/config.js';
import { ascendingFloor, descendingFloor, stakePerTenure, totalDuration } from '../sim/curve.js';

const ZERO = '0x' + '00'.repeat(32);

export interface RentParams {
  readonly tenures: TenureCount;
  /** step-only: payment to validate against the floor (toPtb ignores it). */
  readonly paymentMist?: Mist;
  /** step-only: usufructuary address for the new seat. */
  readonly sender?: string;
  /** step-only: placeholder for the chain-minted UsufructCap id. */
  readonly capId?: string;
}

export interface RentResult {
  /** The curve-derived floor the chain charges per the current state. */
  readonly floorMist: Mist;
  readonly transition: 'install' | 'bid' | 'supersede';
}

export interface RentPtbArgs {
  readonly pkg: Pick<PackageIds, 'packageId'>;
  readonly escrowId: Id<'Escrow'>;
  /** Payment coin (id or result of a previous command, e.g. a split). */
  readonly payment: string | TransactionObjectArgument;
  readonly typeArguments: [string, string];
}

type State = EscrowState<AssetSchema>;
type AssetStateData = NonNullable<State['escrow']['state']>;

export function rent(params: RentParams): TransitionAction<RentResult, RentPtbArgs> {
  return {
    step: (state: State, t: Ms) => {
      const s = state.escrow.state;
      const core = state.escrow.core;
      if (s == null || core == null) throw new Error('EAssetBorrowed');
      const count = BigInt(params.tenures);
      const esc = core.ensemble.active.price_escalation;
      const escUnion =
        esc.$kind === 'FixedDelta'
          ? ({ kind: 'fixedDelta', deltaMist: mist(esc.FixedDelta.delta.mist) } as const)
          : ({
              kind: 'compoundDelta',
              bps: BigInt(esc.CompoundDelta.bps.bps) as never,
              deltaMist: mist(esc.CompoundDelta.delta.mist),
            } as const);

      const seat = (stakeMist: bigint) => ({
        identity: {
          cap_identity: { id: params.capId ?? ZERO },
          address: { addr: params.sender ?? ZERO },
        },
        stake: { balance: { value: String(stakeMist) } },
      });

      let floor: bigint;
      let transition: RentResult['transition'];
      let next: AssetStateData;

      if (s.$kind === 'Waiting') {
        if (s.Waiting.$kind === 'Retired') throw new Error('ERetiredNoBid');
        const cycle = s.Waiting.$kind === 'Idle' ? s.Waiting.Idle.cycle : s.Waiting.Descent.cycle;
        const locked = s.Waiting.$kind === 'Idle' ? s.Waiting.Idle.asset : s.Waiting.Descent.asset;
        floor =
          s.Waiting.$kind === 'Idle'
            ? BigInt(cycle.floor.mist)
            : descendingFloor({
                lastAcqMist: BigInt(s.Waiting.Descent.auction.last_acq_price.mist),
                phaseStartMs: BigInt(s.Waiting.Descent.auction.phase_start.ms),
                floorMist: BigInt(cycle.floor.mist),
                descentMs: BigInt(cycle.descent.ms),
                auctionShape: collapseCurveShape(core.ensemble.active.auction_shape),
                nowMs: t,
              });
        validatePayment(params.paymentMist, floor, count);
        transition = 'install';
        const assetVal = (locked as { asset: unknown }).asset;
        const assetIdStr = (assetVal as { id?: string }).id ?? ZERO;
        next = {
          $kind: 'Renting',
          Renting: {
            $kind: 'Occupied',
            Occupied: {
              asset: {
                identity: {
                  asset_id: { proj_id: assetIdStr },
                  escrow_identity: { id: state.objectId },
                },
                available: assetVal,
              },
              terms: {
                schedule: {
                  phase_start: { ms: String(t) },
                  ceiling_total: { ms: String(totalDuration(BigInt(cycle.ceiling.ms), count)) },
                  handover_total: { ms: String(totalDuration(BigInt(cycle.handover.ms), count)) },
                  committed_tenures: { count: String(count) },
                },
                active: seat(params.paymentMist ?? 0n),
                retire: { $kind: 'NotRetiring', NotRetiring: true },
              },
              cycle,
            },
          },
        } as AssetStateData;
      } else if (s.Renting.$kind === 'Occupied') {
        const occ = s.Renting.Occupied;
        if (occ.terms.retire.$kind === 'Retiring') throw new Error('ERetireFlagBlocksBid');
        floor = ascendingFloor(
          escUnion,
          stakePerTenure(
            BigInt(occ.terms.active.stake.balance.value),
            BigInt(occ.terms.schedule.committed_tenures.count),
          ),
        );
        validatePayment(params.paymentMist, floor, count);
        transition = 'bid';
        const ps = BigInt(occ.terms.schedule.phase_start.ms);
        const handoverTotal = BigInt(occ.terms.schedule.handover_total.ms);
        const ceilingTotal = BigInt(occ.terms.schedule.ceiling_total.ms);
        const expiry = t + handoverTotal < ps + ceilingTotal ? t + handoverTotal : ps + ceilingTotal;
        next = {
          $kind: 'Renting',
          Renting: {
            $kind: 'Demand',
            Demand: {
              asset: occ.asset,
              terms: occ.terms,
              bid: {
                pending: seat(params.paymentMist ?? 0n),
                handover: { expiry: { ms: String(expiry) }, tenures: { count: String(count) } },
              },
              cycle: occ.cycle,
            },
          },
        } as AssetStateData;
      } else {
        const dem = s.Renting.Demand;
        floor = ascendingFloor(
          escUnion,
          stakePerTenure(
            BigInt(dem.bid.pending.stake.balance.value),
            BigInt(dem.bid.handover.tenures.count),
          ),
        );
        validatePayment(params.paymentMist, floor, count);
        transition = 'supersede';
        // Supersede: new pending seat; handover expiry unchanged.
        next = {
          $kind: 'Renting',
          Renting: {
            $kind: 'Demand',
            Demand: { ...dem, bid: { ...dem.bid, pending: seat(params.paymentMist ?? 0n) } },
          },
        } as AssetStateData;
      }

      return {
        state: { ...state, escrow: { ...state.escrow, state: next } },
        result: { floorMist: mist(floor), transition },
      };
    },

    // Returns the UsufructCap — the caller must transfer or consume it.
    toPtb: (tx, args) =>
      tx.add(
        rentCall({
          package: args.pkg.packageId,
          arguments: [
            args.escrowId,
            args.payment,
            tx.add(tenuresCall({ package: args.pkg.packageId, arguments: [params.tenures] })),
          ],
          typeArguments: args.typeArguments,
        }),
      ),
  };
}

/** `payment_covers(payment, compute_total_price(floor, count))` = payment ≥ floor·count. */
function validatePayment(paymentMist: bigint | undefined, floor: bigint, count: bigint): void {
  if (paymentMist != null && paymentMist < floor * count) {
    throw new Error('EInsufficientPayment');
  }
}
