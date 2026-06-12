/**************************************************************
 * THIS FILE IS GENERATED AND SHOULD NOT BE MANUALLY MODIFIED *
 **************************************************************/
import { MoveEnum, MoveStruct } from '../utils/index.js';
import * as phases from './phases.js';
const $moduleName = '@local-pkg/usufruct::retire_commitment_policy';
export const RetireCommitmentPolicy = new MoveEnum({ name: `${$moduleName}::RetireCommitmentPolicy`, fields: {
        Immediate: null,
        Deferred: new MoveStruct({ name: `RetireCommitmentPolicy.Deferred`, fields: {
                floor: phases.Duration
            } })
    } });