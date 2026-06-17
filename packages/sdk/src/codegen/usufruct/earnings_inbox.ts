/**************************************************************
 * THIS FILE IS GENERATED AND SHOULD NOT BE MANUALLY MODIFIED *
 **************************************************************/
import { MoveStruct } from '../utils/index.js';
import { bcs } from '@mysten/sui/bcs';
const $moduleName = '@local-pkg/usufruct::earnings_inbox';
export const EarningsInboxIdentity = new MoveStruct({ name: `${$moduleName}::EarningsInboxIdentity`, fields: {
        id: bcs.Address
    } });
export const EarningsInbox = new MoveStruct({ name: `${$moduleName}::EarningsInbox`, fields: {
        id: bcs.Address
    } });