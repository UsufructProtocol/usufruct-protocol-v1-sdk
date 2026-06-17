/**************************************************************
 * THIS FILE IS GENERATED AND SHOULD NOT BE MANUALLY MODIFIED *
 **************************************************************/
import { MoveStruct } from '../utils/index.js';
import { bcs } from '@mysten/sui/bcs';
import * as escrow_identity from './escrow_identity.js';
const $moduleName = '@local-pkg/usufruct::usufruct_cap';
export const UsufructCapIdentity = new MoveStruct({ name: `${$moduleName}::UsufructCapIdentity`, fields: {
        id: bcs.Address
    } });
export const UsufructCap = new MoveStruct({ name: `${$moduleName}::UsufructCap`, fields: {
        id: bcs.Address,
        escrow_identity: escrow_identity.EscrowIdentity
    } });
export const UsufructCapMinted = new MoveStruct({ name: `${$moduleName}::UsufructCapMinted`, fields: {
        escrow_id: bcs.Address,
        usufruct_cap_id: bcs.Address,
        usufructuary_address: bcs.Address
    } });
export const UsufructCapBurned = new MoveStruct({ name: `${$moduleName}::UsufructCapBurned`, fields: {
        escrow_id: bcs.Address,
        usufruct_cap_id: bcs.Address,
        usufructuary_address: bcs.Address
    } });