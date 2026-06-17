/**************************************************************
 * THIS FILE IS GENERATED AND SHOULD NOT BE MANUALLY MODIFIED *
 **************************************************************/
import { MoveEnum, MoveStruct } from '../utils/index.js';
import * as fee_message from './fee_message.js';
import * as earnings_balance from './earnings_balance.js';
import * as usufructuary_seat from './usufructuary_seat.js';
const $moduleName = '@local-pkg/usufruct::refund_state';
export const RefundState = new MoveEnum({ name: `${$moduleName}::RefundState<phantom CoinType>`, fields: {
        Nothing: new MoveStruct({ name: `RefundState.Nothing`, fields: {
                fee_share: fee_message.FeeShare,
                earnings: earnings_balance.EarningsBalance
            } }),
        Parcial: new MoveStruct({ name: `RefundState.Parcial`, fields: {
                usufructuary_seat: usufructuary_seat.UsufructuarySeat,
                fee_share: fee_message.FeeShare,
                earnings: earnings_balance.EarningsBalance
            } }),
        Total: new MoveStruct({ name: `RefundState.Total`, fields: {
                usufructuary_seat: usufructuary_seat.UsufructuarySeat
            } })
    } });