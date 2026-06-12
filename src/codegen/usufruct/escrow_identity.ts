/**************************************************************
 * THIS FILE IS GENERATED AND SHOULD NOT BE MANUALLY MODIFIED *
 **************************************************************/
import { MoveStruct } from '../utils/index.js';
import { bcs } from '@mysten/sui/bcs';
const $moduleName = '@local-pkg/usufruct::escrow_identity';
export const EscrowIdentity = new MoveStruct({ name: `${$moduleName}::EscrowIdentity`, fields: {
        id: bcs.Address
    } });