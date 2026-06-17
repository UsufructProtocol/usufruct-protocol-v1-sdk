/**************************************************************
 * THIS FILE IS GENERATED AND SHOULD NOT BE MANUALLY MODIFIED *
 **************************************************************/
import { MoveStruct } from '../utils/index.js';
import { bcs } from '@mysten/sui/bcs';
const $moduleName = '@local-pkg/usufruct::math';
export const BasisPoints = new MoveStruct({ name: `${$moduleName}::BasisPoints`, fields: {
        bps: bcs.u64()
    } });