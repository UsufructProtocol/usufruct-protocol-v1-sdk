/**************************************************************
 * THIS FILE IS GENERATED AND SHOULD NOT BE MANUALLY MODIFIED *
 **************************************************************/
import { MoveStruct } from '../utils/index.js';
import * as balance from './deps/sui/balance.js';
const $moduleName = '@local-pkg/usufruct::earnings_balance';
export const EarningsBalance = new MoveStruct({ name: `${$moduleName}::EarningsBalance<phantom CoinType>`, fields: {
        balance: balance.Balance
    } });