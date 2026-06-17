/**************************************************************
 * THIS FILE IS GENERATED AND SHOULD NOT BE MANUALLY MODIFIED *
 **************************************************************/
import { MoveStruct } from '../utils/index.js';
import { bcs } from '@mysten/sui/bcs';
const $moduleName = '@local-pkg/usufruct::protocol_fee_inbox';
export const ProtocolFeeInbox = new MoveStruct({ name: `${$moduleName}::ProtocolFeeInbox`, fields: {
        id: bcs.Address
    } });