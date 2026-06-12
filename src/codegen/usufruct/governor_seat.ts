/**************************************************************
 * THIS FILE IS GENERATED AND SHOULD NOT BE MANUALLY MODIFIED *
 **************************************************************/
import { MoveStruct } from '../utils/index.js';
import * as governor_identity from './governor_identity.js';
import * as earnings_inbox from './earnings_inbox.js';
const $moduleName = '@local-pkg/usufruct::governor_seat';
export const GovernorSeat = new MoveStruct({ name: `${$moduleName}::GovernorSeat`, fields: {
        identity: governor_identity.GovernorIdentity,
        inbox: earnings_inbox.EarningsInboxIdentity
    } });