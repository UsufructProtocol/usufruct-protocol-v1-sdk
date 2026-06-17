/**************************************************************
 * THIS FILE IS GENERATED AND SHOULD NOT BE MANUALLY MODIFIED *
 **************************************************************/
import { MoveStruct } from '../utils/index.js';
import { bcs } from '@mysten/sui/bcs';
import * as rest_price_policy from './rest_price_policy.js';
import * as tenure_duration_policy from './tenure_duration_policy.js';
import * as tenure_extend_policy from './tenure_extend_policy.js';
import * as handover_policy from './handover_policy.js';
import * as auction_window_policy from './auction_window_policy.js';
import * as curve_shape_policy from './curve_shape_policy.js';
import * as price_escalation_policy from './price_escalation_policy.js';
const $moduleName = '@local-pkg/usufruct::policy_ensemble';
export const PolicyEnsemble = new MoveStruct({ name: `${$moduleName}::PolicyEnsemble`, fields: {
        rest_price: rest_price_policy.RestPricePolicy,
        tenure_duration: tenure_duration_policy.TenureDurationPolicy,
        tenure_extend: tenure_extend_policy.TenureExtendPolicy,
        handover: handover_policy.HandoverPolicy,
        auction_window: auction_window_policy.AuctionWindowPolicy,
        credit_shape: curve_shape_policy.CurveShapePolicy,
        auction_shape: curve_shape_policy.CurveShapePolicy,
        price_escalation: price_escalation_policy.PriceEscalationPolicy
    } });
export const PolicyEnsembleRegistered = new MoveStruct({ name: `${$moduleName}::PolicyEnsembleRegistered`, fields: {
        escrow_id: bcs.Address,
        timestamp_ms: bcs.u64(),
        rest_price_policy: bcs.string(),
        rest_price: bcs.u64(),
        tenure_duration_policy: bcs.string(),
        tenure_duration_ms: bcs.u64(),
        tenure_extend_policy: bcs.string(),
        handover_policy: bcs.string(),
        handover_floor_ms: bcs.option(bcs.u64()),
        auction_window_policy: bcs.string(),
        auction_window_ceiling_ms: bcs.option(bcs.u64()),
        credit_shape_policy: bcs.string(),
        credit_alpha_num: bcs.option(bcs.u8()),
        credit_alpha_den: bcs.option(bcs.u8()),
        credit_alpha_abs: bcs.option(bcs.u8()),
        credit_alpha_neg: bcs.option(bcs.bool()),
        auction_shape_policy: bcs.string(),
        auction_alpha_num: bcs.option(bcs.u8()),
        auction_alpha_den: bcs.option(bcs.u8()),
        auction_alpha_abs: bcs.option(bcs.u8()),
        auction_alpha_neg: bcs.option(bcs.bool()),
        price_escalation_policy: bcs.string(),
        price_escalation_delta: bcs.u64(),
        price_escalation_bps: bcs.option(bcs.u64())
    } });
export const EnsembleUpdated = new MoveStruct({ name: `${$moduleName}::EnsembleUpdated`, fields: {
        escrow_id: bcs.Address,
        timestamp_ms: bcs.u64(),
        rest_price_policy: bcs.string(),
        rest_price: bcs.u64(),
        tenure_duration_policy: bcs.string(),
        tenure_duration_ms: bcs.u64(),
        tenure_extend_policy: bcs.string(),
        handover_policy: bcs.string(),
        handover_floor_ms: bcs.option(bcs.u64()),
        auction_window_policy: bcs.string(),
        auction_window_ceiling_ms: bcs.option(bcs.u64()),
        credit_shape_policy: bcs.string(),
        credit_alpha_num: bcs.option(bcs.u8()),
        credit_alpha_den: bcs.option(bcs.u8()),
        credit_alpha_abs: bcs.option(bcs.u8()),
        credit_alpha_neg: bcs.option(bcs.bool()),
        auction_shape_policy: bcs.string(),
        auction_alpha_num: bcs.option(bcs.u8()),
        auction_alpha_den: bcs.option(bcs.u8()),
        auction_alpha_abs: bcs.option(bcs.u8()),
        auction_alpha_neg: bcs.option(bcs.bool()),
        price_escalation_policy: bcs.string(),
        price_escalation_delta: bcs.u64(),
        price_escalation_bps: bcs.option(bcs.u64())
    } });
export const EnsembleUpdateScheduled = new MoveStruct({ name: `${$moduleName}::EnsembleUpdateScheduled`, fields: {
        escrow_id: bcs.Address,
        timestamp_ms: bcs.u64(),
        rest_price_policy: bcs.string(),
        rest_price: bcs.u64(),
        tenure_duration_policy: bcs.string(),
        tenure_duration_ms: bcs.u64(),
        tenure_extend_policy: bcs.string(),
        handover_policy: bcs.string(),
        handover_floor_ms: bcs.option(bcs.u64()),
        auction_window_policy: bcs.string(),
        auction_window_ceiling_ms: bcs.option(bcs.u64()),
        credit_shape_policy: bcs.string(),
        credit_alpha_num: bcs.option(bcs.u8()),
        credit_alpha_den: bcs.option(bcs.u8()),
        credit_alpha_abs: bcs.option(bcs.u8()),
        credit_alpha_neg: bcs.option(bcs.bool()),
        auction_shape_policy: bcs.string(),
        auction_alpha_num: bcs.option(bcs.u8()),
        auction_alpha_den: bcs.option(bcs.u8()),
        auction_alpha_abs: bcs.option(bcs.u8()),
        auction_alpha_neg: bcs.option(bcs.bool()),
        price_escalation_policy: bcs.string(),
        price_escalation_delta: bcs.u64(),
        price_escalation_bps: bcs.option(bcs.u64())
    } });