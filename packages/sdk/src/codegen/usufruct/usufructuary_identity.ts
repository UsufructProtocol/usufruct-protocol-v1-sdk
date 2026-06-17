/**************************************************************
 * THIS FILE IS GENERATED AND SHOULD NOT BE MANUALLY MODIFIED *
 **************************************************************/
import { MoveStruct } from '../utils/index.js';
import * as usufruct_cap from './usufruct_cap.js';
import * as refund_address from './refund_address.js';
const $moduleName = '@local-pkg/usufruct::usufructuary_identity';
export const UsufructuaryIdentity = new MoveStruct({ name: `${$moduleName}::UsufructuaryIdentity`, fields: {
        cap_identity: usufruct_cap.UsufructCapIdentity,
        address: refund_address.RefundAddress
    } });