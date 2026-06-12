/**************************************************************
 * THIS FILE IS GENERATED AND SHOULD NOT BE MANUALLY MODIFIED *
 **************************************************************/
import { MoveStruct, MoveEnum } from '../utils/index.js';
import { bcs } from '@mysten/sui/bcs';
const $moduleName = '@local-pkg/usufruct::phases';
export const Timestamp = new MoveStruct({ name: `${$moduleName}::Timestamp`, fields: {
        ms: bcs.u64()
    } });
export const Duration = new MoveStruct({ name: `${$moduleName}::Duration`, fields: {
        ms: bcs.u64()
    } });
export const Elapsed = new MoveStruct({ name: `${$moduleName}::Elapsed`, fields: {
        ms: bcs.u64()
    } });
export const Boundary = new MoveEnum({ name: `${$moduleName}::Boundary`, fields: {
        Pending: new MoveStruct({ name: `Boundary.Pending`, fields: {
                remaining: Duration
            } }),
        Crossed: new MoveStruct({ name: `Boundary.Crossed`, fields: {
                overdue: Duration
            } })
    } });