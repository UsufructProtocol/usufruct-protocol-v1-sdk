/**************************************************************
 * THIS FILE IS GENERATED AND SHOULD NOT BE MANUALLY MODIFIED *
 **************************************************************/
import { MoveStruct } from '../utils/index.js';
import * as asset_identity from './asset_identity.js';
import * as escrow_identity from './escrow_identity.js';
const $moduleName = '@local-pkg/usufruct::escrowed_asset_identity';
export const EscrowedAssetIdentity = new MoveStruct({ name: `${$moduleName}::EscrowedAssetIdentity`, fields: {
        asset_id: asset_identity.AssetIdentity,
        escrow_identity: escrow_identity.EscrowIdentity
    } });