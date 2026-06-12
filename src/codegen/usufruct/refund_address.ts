/**************************************************************
 * THIS FILE IS GENERATED AND SHOULD NOT BE MANUALLY MODIFIED *
 **************************************************************/
import { MoveStruct } from '../utils/index.js';
import { bcs } from '@mysten/sui/bcs';
const $moduleName = '@local-pkg/usufruct::refund_address';
export const RefundAddress = new MoveStruct({ name: `${$moduleName}::RefundAddress`, fields: {
        addr: bcs.Address
    } });