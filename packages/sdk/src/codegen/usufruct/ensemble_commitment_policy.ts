/**************************************************************
 * THIS FILE IS GENERATED AND SHOULD NOT BE MANUALLY MODIFIED *
 **************************************************************/
import { MoveEnum, MoveStruct } from '../utils/index.js';
import * as phases from './phases.js';
const $moduleName = '@local-pkg/usufruct::ensemble_commitment_policy';
export const EnsembleCommitmentPolicy = new MoveEnum({ name: `${$moduleName}::EnsembleCommitmentPolicy`, fields: {
        Immediate: null,
        Deferred: new MoveStruct({ name: `EnsembleCommitmentPolicy.Deferred`, fields: {
                floor: phases.Duration
            } })
    } });