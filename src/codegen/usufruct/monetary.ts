/**************************************************************
 * THIS FILE IS GENERATED AND SHOULD NOT BE MANUALLY MODIFIED *
 **************************************************************/
import { MoveStruct } from '../utils/index.js';
import { bcs } from '@mysten/sui/bcs';
const $moduleName = '@local-pkg/usufruct::monetary';
export const Price = new MoveStruct({ name: `${$moduleName}::Price`, fields: {
        mist: bcs.u64()
    } });
export const Stake = new MoveStruct({ name: `${$moduleName}::Stake`, fields: {
        mist: bcs.u64()
    } });