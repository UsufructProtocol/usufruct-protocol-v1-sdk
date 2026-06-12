/**************************************************************
 * THIS FILE IS GENERATED AND SHOULD NOT BE MANUALLY MODIFIED *
 **************************************************************/
import { MoveStruct } from '../utils/index.js';
import { bcs } from '@mysten/sui/bcs';
const $moduleName = '@local-pkg/usufruct::governance_cap';
export const GovernanceCapIdentity = new MoveStruct({ name: `${$moduleName}::GovernanceCapIdentity`, fields: {
        id: bcs.Address
    } });
export const GovernanceCap = new MoveStruct({ name: `${$moduleName}::GovernanceCap`, fields: {
        id: bcs.Address
    } });
export const GovernanceCapMinted = new MoveStruct({ name: `${$moduleName}::GovernanceCapMinted`, fields: {
        escrow_id: bcs.Address,
        governance_cap_id: bcs.Address,
        governor_address: bcs.Address
    } });
export const GovernanceCapBurned = new MoveStruct({ name: `${$moduleName}::GovernanceCapBurned`, fields: {
        governance_cap_id: bcs.Address,
        governor_address: bcs.Address
    } });