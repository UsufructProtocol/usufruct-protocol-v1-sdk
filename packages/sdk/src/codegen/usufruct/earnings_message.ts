/**************************************************************
 * THIS FILE IS GENERATED AND SHOULD NOT BE MANUALLY MODIFIED *
 **************************************************************/
import { MoveStruct } from '../utils/index.js';
import { bcs } from '@mysten/sui/bcs';
import * as balance from './deps/sui/balance.js';
const $moduleName = '@local-pkg/usufruct::earnings_message';
export const EarningsMessage = new MoveStruct({ name: `${$moduleName}::EarningsMessage<phantom CoinType>`, fields: {
        id: bcs.Address,
        balance: balance.Balance
    } });
export const EarningsMessagePosted = new MoveStruct({ name: `${$moduleName}::EarningsMessagePosted`, fields: {
        escrow_id: bcs.Address,
        earnings_message_id: bcs.Address,
        earnings_inbox_id: bcs.Address,
        amount: bcs.u64(),
        coin_type: bcs.string()
    } });
export const EarningsMessageCollected = new MoveStruct({ name: `${$moduleName}::EarningsMessageCollected`, fields: {
        earnings_message_id: bcs.Address,
        earnings_inbox_id: bcs.Address,
        amount: bcs.u64(),
        collector: bcs.Address,
        coin_type: bcs.string()
    } });