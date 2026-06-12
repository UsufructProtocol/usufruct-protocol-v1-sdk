/**************************************************************
 * THIS FILE IS GENERATED AND SHOULD NOT BE MANUALLY MODIFIED *
 **************************************************************/
import { MoveStruct } from '../utils/index.js';
import { bcs } from '@mysten/sui/bcs';
const $moduleName = '@local-pkg/usufruct::tenures';
export const Tenures = new MoveStruct({ name: `${$moduleName}::Tenures`, fields: {
        count: bcs.u64()
    } });
export const StakePerTenure = new MoveStruct({ name: `${$moduleName}::StakePerTenure`, fields: {
        mist: bcs.u64()
    } });
export const TotalDue = new MoveStruct({ name: `${$moduleName}::TotalDue`, fields: {
        mist: bcs.u64()
    } });