/**************************************************************
 * THIS FILE IS GENERATED AND SHOULD NOT BE MANUALLY MODIFIED *
 **************************************************************/
import { MoveStruct } from '../utils/index.js';
import * as governance_cap from './governance_cap.js';
const $moduleName = '@local-pkg/usufruct::governor_identity';
export const GovernorIdentity = new MoveStruct({ name: `${$moduleName}::GovernorIdentity`, fields: {
        cap_identity: governance_cap.GovernanceCapIdentity
    } });