/**************************************************************
 * THIS FILE IS GENERATED AND SHOULD NOT BE MANUALLY MODIFIED *
 **************************************************************/
import { MoveEnum, MoveStruct } from '../utils/index.js';
import * as phases from './phases.js';
const $moduleName = '@local-pkg/usufruct::handover_policy';
export const HandoverPolicy = new MoveEnum({ name: `${$moduleName}::HandoverPolicy`, fields: {
        Off: null,
        FullTenure: null,
        Fixed: new MoveStruct({ name: `HandoverPolicy.Fixed`, fields: {
                floor: phases.Duration
            } })
    } });