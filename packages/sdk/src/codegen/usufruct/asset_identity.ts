/**************************************************************
 * THIS FILE IS GENERATED AND SHOULD NOT BE MANUALLY MODIFIED *
 **************************************************************/
import { MoveStruct } from '../utils/index.js';
import { bcs } from '@mysten/sui/bcs';
const $moduleName = '@local-pkg/usufruct::asset_identity';
export const AssetIdentity = new MoveStruct({ name: `${$moduleName}::AssetIdentity`, fields: {
        proj_id: bcs.Address
    } });