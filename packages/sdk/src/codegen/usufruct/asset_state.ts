/**************************************************************
 * THIS FILE IS GENERATED AND SHOULD NOT BE MANUALLY MODIFIED *
 **************************************************************/
import { MoveStruct, MoveEnum } from '../utils/index.js';
import { type BcsType, bcs } from '@mysten/sui/bcs';
import * as phases from './phases.js';
import * as tenures from './tenures.js';
import * as usufructuary_seat from './usufructuary_seat.js';
import * as monetary from './monetary.js';
import * as asset_custody from './asset_custody.js';
import * as escrowed_asset_identity from './escrowed_asset_identity.js';
import * as policy_ensemble from './policy_ensemble.js';
import * as retire_commitment_policy from './retire_commitment_policy.js';
import * as ensemble_commitment_policy from './ensemble_commitment_policy.js';
import * as governor_seat from './governor_seat.js';
import * as protocol_fee_ref from './protocol_fee_ref.js';
import * as escrow_identity from './escrow_identity.js';
import * as curve_shape_policy from './curve_shape_policy.js';
import * as price_escalation_policy from './price_escalation_policy.js';
const $moduleName = '@local-pkg/usufruct::asset_state';
export const TenancySchedule = new MoveStruct({ name: `${$moduleName}::TenancySchedule`, fields: {
        phase_start: phases.Timestamp,
        ceiling_total: phases.Duration,
        handover_total: phases.Duration,
        committed_tenures: tenures.Tenures
    } });
export const RetireCondition = new MoveEnum({ name: `${$moduleName}::RetireCondition`, fields: {
        NotRetiring: null,
        Retiring: null
    } });
export const OccupiedTerms = new MoveStruct({ name: `${$moduleName}::OccupiedTerms<phantom CoinType>`, fields: {
        schedule: TenancySchedule,
        active: usufructuary_seat.UsufructuarySeat,
        retire: RetireCondition
    } });
export const CycleParams = new MoveStruct({ name: `${$moduleName}::CycleParams`, fields: {
        floor: monetary.Price,
        ceiling: phases.Duration,
        handover: phases.Duration,
        descent: phases.Duration
    } });
export const HandoverTerms = new MoveStruct({ name: `${$moduleName}::HandoverTerms`, fields: {
        expiry: phases.Timestamp,
        tenures: tenures.Tenures
    } });
export const DemandTerms = new MoveStruct({ name: `${$moduleName}::DemandTerms<phantom CoinType>`, fields: {
        pending: usufructuary_seat.UsufructuarySeat,
        handover: HandoverTerms
    } });
export function RentingState<Asset extends BcsType<any>>(...typeParameters: [
    Asset
]) {
    return new MoveEnum({ name: `${$moduleName}::RentingState<${typeParameters[0].name as Asset['name']}, phantom CoinType>`, fields: {
            Occupied: new MoveStruct({ name: `RentingState.Occupied`, fields: {
                    asset: asset_custody.AssetCustodyOpen(typeParameters[0]),
                    terms: OccupiedTerms,
                    cycle: CycleParams
                } }),
            Demand: new MoveStruct({ name: `RentingState.Demand`, fields: {
                    asset: asset_custody.AssetCustodyOpen(typeParameters[0]),
                    terms: OccupiedTerms,
                    bid: DemandTerms,
                    cycle: CycleParams
                } })
        } });
}
export function AssetReceipt<Asset extends BcsType<any>>(...typeParameters: [
    Asset
]) {
    return new MoveStruct({ name: `${$moduleName}::AssetReceipt<${typeParameters[0].name as Asset['name']}, phantom CoinType>`, fields: {
            identity: escrowed_asset_identity.EscrowedAssetIdentity,
            renting: RentingState(typeParameters[0])
        } });
}
export const AuctionTerms = new MoveStruct({ name: `${$moduleName}::AuctionTerms`, fields: {
        last_acq_price: monetary.Price,
        phase_start: phases.Timestamp
    } });
export const EnsembleSlot = new MoveStruct({ name: `${$moduleName}::EnsembleSlot`, fields: {
        active: policy_ensemble.PolicyEnsemble,
        pending: bcs.option(policy_ensemble.PolicyEnsemble)
    } });
export const RetireCommitmentSlot = new MoveStruct({ name: `${$moduleName}::RetireCommitmentSlot`, fields: {
        policy: retire_commitment_policy.RetireCommitmentPolicy,
        anchor: phases.Timestamp
    } });
export const EnsembleCommitmentSlot = new MoveStruct({ name: `${$moduleName}::EnsembleCommitmentSlot`, fields: {
        policy: ensemble_commitment_policy.EnsembleCommitmentPolicy,
        anchor: phases.Timestamp
    } });
export const EscrowCore = new MoveStruct({ name: `${$moduleName}::EscrowCore<phantom CoinType>`, fields: {
        governor_seat: governor_seat.GovernorSeat,
        ensemble: EnsembleSlot,
        fee_inbox_identity: protocol_fee_ref.FeeInboxIdentity,
        integrated_at: phases.Timestamp,
        retire_commitment: RetireCommitmentSlot,
        ensemble_commitment: EnsembleCommitmentSlot,
        escrow_identity: escrow_identity.EscrowIdentity
    } });
export const RentStarted = new MoveStruct({ name: `${$moduleName}::RentStarted`, fields: {
        escrow_id: bcs.Address,
        asset_type: bcs.string(),
        coin_type: bcs.string(),
        usufruct_cap_id: bcs.Address,
        usufructuary_address: bcs.Address,
        price_paid: bcs.u64(),
        floor_price: bcs.u64(),
        committed_tenures: bcs.u64(),
        timestamp_ms: bcs.u64(),
        ceiling_total_ms: bcs.u64(),
        handover_total_ms: bcs.u64()
    } });
export const AuctionExpired = new MoveStruct({ name: `${$moduleName}::AuctionExpired`, fields: {
        escrow_id: bcs.Address,
        asset_type: bcs.string(),
        coin_type: bcs.string(),
        phase_start_ms: bcs.u64(),
        last_acq_price: bcs.u64(),
        timestamp_ms: bcs.u64()
    } });
export const CycleParamsResolved = new MoveStruct({ name: `${$moduleName}::CycleParamsResolved`, fields: {
        escrow_id: bcs.Address,
        floor_mist: bcs.u64(),
        ceiling_ms: bcs.u64(),
        handover_ms: bcs.u64(),
        descent_ms: bcs.u64(),
        auction_shape: curve_shape_policy.CurveShapePolicy,
        credit_shape: curve_shape_policy.CurveShapePolicy,
        escalation: price_escalation_policy.PriceEscalationPolicy,
        timestamp_ms: bcs.u64()
    } });
export const AssetRetired = new MoveStruct({ name: `${$moduleName}::AssetRetired`, fields: {
        escrow_id: bcs.Address,
        asset_type: bcs.string(),
        coin_type: bcs.string(),
        timestamp_ms: bcs.u64()
    } });
export const RetireCommitmentExtended = new MoveStruct({ name: `${$moduleName}::RetireCommitmentExtended`, fields: {
        escrow_id: bcs.Address,
        asset_type: bcs.string(),
        coin_type: bcs.string(),
        commitment_policy: bcs.string(),
        commitment_floor_ms: bcs.option(bcs.u64()),
        new_unlock_at_ms: bcs.u64(),
        timestamp_ms: bcs.u64()
    } });
export const EnsembleCommitmentExtended = new MoveStruct({ name: `${$moduleName}::EnsembleCommitmentExtended`, fields: {
        escrow_id: bcs.Address,
        asset_type: bcs.string(),
        coin_type: bcs.string(),
        commitment_policy: bcs.string(),
        commitment_floor_ms: bcs.option(bcs.u64()),
        new_unlock_at_ms: bcs.u64(),
        timestamp_ms: bcs.u64()
    } });
export const AssetIntegrated = new MoveStruct({ name: `${$moduleName}::AssetIntegrated`, fields: {
        escrow_id: bcs.Address,
        asset_type: bcs.string(),
        coin_type: bcs.string(),
        governance_cap_id: bcs.Address,
        governor_address: bcs.Address,
        asset_id: bcs.Address,
        fee_inbox_id: bcs.Address,
        earnings_inbox_id: bcs.Address,
        retire_commitment_unlock_at_ms: bcs.u64(),
        ensemble_commitment_unlock_at_ms: bcs.u64(),
        timestamp_ms: bcs.u64()
    } });
export const AssetClaimed = new MoveStruct({ name: `${$moduleName}::AssetClaimed`, fields: {
        escrow_id: bcs.Address,
        asset_type: bcs.string(),
        coin_type: bcs.string(),
        governance_cap_id: bcs.Address,
        governor_address: bcs.Address,
        timestamp_ms: bcs.u64()
    } });
export const BidPlaced = new MoveStruct({ name: `${$moduleName}::BidPlaced`, fields: {
        escrow_id: bcs.Address,
        asset_type: bcs.string(),
        coin_type: bcs.string(),
        active_usufruct_cap_id: bcs.Address,
        active_usufructuary_address: bcs.Address,
        active_stake_balance: bcs.u64(),
        active_phase_start_ms: bcs.u64(),
        pending_usufruct_cap_id: bcs.Address,
        pending_usufructuary_address: bcs.Address,
        pending_bid_amount: bcs.u64(),
        pending_ceiling_total_ms: bcs.u64(),
        pending_handover_total_ms: bcs.u64(),
        floor_price: bcs.u64(),
        handover_countdown_expiry: bcs.u64(),
        committed_tenures: bcs.u64(),
        timestamp_ms: bcs.u64()
    } });
export const BidSuperseded = new MoveStruct({ name: `${$moduleName}::BidSuperseded`, fields: {
        escrow_id: bcs.Address,
        asset_type: bcs.string(),
        coin_type: bcs.string(),
        active_usufruct_cap_id: bcs.Address,
        active_usufructuary_address: bcs.Address,
        active_stake_balance: bcs.u64(),
        active_phase_start_ms: bcs.u64(),
        displaced_usufruct_cap_id: bcs.Address,
        displaced_bidder_address: bcs.Address,
        refunded_amount: bcs.u64(),
        pending_usufruct_cap_id: bcs.Address,
        pending_bidder_address: bcs.Address,
        pending_bid_amount: bcs.u64(),
        pending_ceiling_total_ms: bcs.u64(),
        pending_handover_total_ms: bcs.u64(),
        floor_price: bcs.u64(),
        handover_countdown_expiry: bcs.u64(),
        committed_tenures: bcs.u64(),
        timestamp_ms: bcs.u64()
    } });
export const HandoverCompleted = new MoveStruct({ name: `${$moduleName}::HandoverCompleted`, fields: {
        escrow_id: bcs.Address,
        asset_type: bcs.string(),
        coin_type: bcs.string(),
        departing_usufruct_cap_id: bcs.Address,
        departing_usufructuary_address: bcs.Address,
        departing_phase_start_ms: bcs.u64(),
        departing_ceiling_total_ms: bcs.u64(),
        departing_handover_total_ms: bcs.u64(),
        active_usufruct_cap_id: bcs.Address,
        active_usufructuary_address: bcs.Address,
        active_stake_balance: bcs.u64(),
        used_credit: bcs.u64(),
        remain_credit: bcs.u64(),
        governor_share: bcs.u64(),
        protocol_fee: bcs.u64(),
        departing_refund_amount: bcs.u64(),
        new_rent_price: bcs.u64(),
        committed_tenures: bcs.u64(),
        ceiling_total_ms: bcs.u64(),
        handover_total_ms: bcs.u64(),
        timestamp_ms: bcs.u64()
    } });
export const TenureExpired = new MoveStruct({ name: `${$moduleName}::TenureExpired`, fields: {
        escrow_id: bcs.Address,
        asset_type: bcs.string(),
        coin_type: bcs.string(),
        usufruct_cap_id: bcs.Address,
        usufructuary_address: bcs.Address,
        phase_start_ms: bcs.u64(),
        governor_share: bcs.u64(),
        protocol_fee: bcs.u64(),
        last_acquisition_price: bcs.u64(),
        timestamp_ms: bcs.u64()
    } });
export const RetireFlagSet = new MoveStruct({ name: `${$moduleName}::RetireFlagSet`, fields: {
        escrow_id: bcs.Address,
        asset_type: bcs.string(),
        coin_type: bcs.string(),
        governance_cap_id: bcs.Address,
        governor_address: bcs.Address,
        timestamp_ms: bcs.u64()
    } });
export const AssetBorrowed = new MoveStruct({ name: `${$moduleName}::AssetBorrowed`, fields: {
        escrow_id: bcs.Address,
        asset_type: bcs.string(),
        coin_type: bcs.string(),
        usufruct_cap_id: bcs.Address,
        usufructuary_address: bcs.Address,
        timestamp_ms: bcs.u64()
    } });
export const AssetReturned = new MoveStruct({ name: `${$moduleName}::AssetReturned`, fields: {
        escrow_id: bcs.Address,
        asset_type: bcs.string(),
        coin_type: bcs.string(),
        usufruct_cap_id: bcs.Address,
        usufructuary_address: bcs.Address
    } });
export const ActiveUsufructuaryRefundAddressUpdated = new MoveStruct({ name: `${$moduleName}::ActiveUsufructuaryRefundAddressUpdated`, fields: {
        escrow_id: bcs.Address,
        asset_type: bcs.string(),
        coin_type: bcs.string(),
        usufruct_cap_id: bcs.Address,
        old_address: bcs.Address,
        active_address: bcs.Address,
        timestamp_ms: bcs.u64()
    } });
export const PendingUsufructuaryRefundAddressUpdated = new MoveStruct({ name: `${$moduleName}::PendingUsufructuaryRefundAddressUpdated`, fields: {
        escrow_id: bcs.Address,
        asset_type: bcs.string(),
        coin_type: bcs.string(),
        usufruct_cap_id: bcs.Address,
        old_address: bcs.Address,
        active_address: bcs.Address,
        timestamp_ms: bcs.u64()
    } });
export function WaitingState<Asset extends BcsType<any>>(...typeParameters: [
    Asset
]) {
    return new MoveEnum({ name: `${$moduleName}::WaitingState<${typeParameters[0].name as Asset['name']}>`, fields: {
            Idle: new MoveStruct({ name: `WaitingState.Idle`, fields: {
                    asset: asset_custody.AssetCustodyLocked(typeParameters[0]),
                    cycle: CycleParams
                } }),
            Descent: new MoveStruct({ name: `WaitingState.Descent`, fields: {
                    asset: asset_custody.AssetCustodyLocked(typeParameters[0]),
                    auction: AuctionTerms,
                    cycle: CycleParams
                } }),
            Retired: new MoveStruct({ name: `WaitingState.Retired`, fields: {
                    asset: asset_custody.AssetCustodyLocked(typeParameters[0])
                } })
        } });
}
export function AssetState<Asset extends BcsType<any>>(...typeParameters: [
    Asset
]) {
    return new MoveEnum({ name: `${$moduleName}::AssetState<${typeParameters[0].name as Asset['name']}, phantom CoinType>`, fields: {
            Waiting: WaitingState(typeParameters[0]),
            Renting: RentingState(typeParameters[0])
        } });
}