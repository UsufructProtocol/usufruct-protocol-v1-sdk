/**************************************************************
 * THIS FILE IS GENERATED AND SHOULD NOT BE MANUALLY MODIFIED *
 **************************************************************/
import { MoveEnum, MoveStruct } from '../utils/index.js';
import * as phases from './phases.js';
const $moduleName = '@local-pkg/usufruct::tenure_duration_policy';
export const TenureDurationPolicy = new MoveEnum({ name: `${$moduleName}::TenureDurationPolicy`, fields: {
        Fixed: new MoveStruct({ name: `TenureDurationPolicy.Fixed`, fields: {
                ceiling: phases.Duration
            } })
    } });