/**************************************************************
 * THIS FILE IS GENERATED AND SHOULD NOT BE MANUALLY MODIFIED *
 **************************************************************/
import { MoveStruct } from '../utils/index.js';
import { bcs } from '@mysten/sui/bcs';
const $moduleName = '@local-pkg/usufruct::protocol_fee_ref';
export const FeeInboxIdentity = new MoveStruct({ name: `${$moduleName}::FeeInboxIdentity`, fields: {
        id: bcs.Address
    } });
export const ProtocolFeeRef = new MoveStruct({ name: `${$moduleName}::ProtocolFeeRef`, fields: {
        id: bcs.Address,
        proj_id: FeeInboxIdentity
    } });