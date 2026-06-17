/**************************************************************
 * THIS FILE IS GENERATED AND SHOULD NOT BE MANUALLY MODIFIED *
 **************************************************************/
import { MoveStruct } from '../utils/index.js';
import * as usufructuary_identity from './usufructuary_identity.js';
import * as stake_balance from './stake_balance.js';
const $moduleName = '@local-pkg/usufruct::usufructuary_seat';
export const UsufructuarySeat = new MoveStruct({ name: `${$moduleName}::UsufructuarySeat<phantom CoinType>`, fields: {
        identity: usufructuary_identity.UsufructuaryIdentity,
        stake: stake_balance.StakeBalance
    } });