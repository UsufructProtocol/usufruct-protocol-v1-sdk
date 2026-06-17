/**************************************************************
 * THIS FILE IS GENERATED AND SHOULD NOT BE MANUALLY MODIFIED *
 **************************************************************/
import { MoveStruct } from '../utils/index.js';
import * as balance from './deps/sui/balance.js';
const $moduleName = '@local-pkg/usufruct::stake_balance';
export const StakeBalance = new MoveStruct({ name: `${$moduleName}::StakeBalance<phantom CoinType>`, fields: {
        balance: balance.Balance
    } });