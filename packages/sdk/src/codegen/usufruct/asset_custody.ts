/**************************************************************
 * THIS FILE IS GENERATED AND SHOULD NOT BE MANUALLY MODIFIED *
 **************************************************************/
import { type BcsType, bcs } from '@mysten/sui/bcs';
import { MoveStruct } from '../utils/index.js';
import * as escrowed_asset_identity from './escrowed_asset_identity.js';
const $moduleName = '@local-pkg/usufruct::asset_custody';
export function AssetCustodyOpen<U extends BcsType<any>>(...typeParameters: [
    U
]) {
    return new MoveStruct({ name: `${$moduleName}::AssetCustodyOpen<${typeParameters[0].name as U['name']}>`, fields: {
            identity: escrowed_asset_identity.EscrowedAssetIdentity,
            available: bcs.option(typeParameters[0])
        } });
}
export function AssetCustodyLocked<U extends BcsType<any>>(...typeParameters: [
    U
]) {
    return new MoveStruct({ name: `${$moduleName}::AssetCustodyLocked<${typeParameters[0].name as U['name']}>`, fields: {
            asset: typeParameters[0]
        } });
}