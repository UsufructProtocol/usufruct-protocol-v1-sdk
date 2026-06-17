/**************************************************************
 * THIS FILE IS GENERATED AND SHOULD NOT BE MANUALLY MODIFIED *
 **************************************************************/
import { MoveStruct } from '../utils/index.js';
import { bcs } from '@mysten/sui/bcs';
import * as balance from './deps/sui/balance.js';
import * as escrow_identity from './escrow_identity.js';
const $moduleName = '@local-pkg/usufruct::fee_message';
export const FeeShare = new MoveStruct({ name: `${$moduleName}::FeeShare<phantom CoinType>`, fields: {
        balance: balance.Balance,
        escrow_identity: escrow_identity.EscrowIdentity
    } });
export const FeeMessage = new MoveStruct({ name: `${$moduleName}::FeeMessage<phantom CoinType>`, fields: {
        id: bcs.Address,
        balance: balance.Balance
    } });
export const FeeMessagePosted = new MoveStruct({ name: `${$moduleName}::FeeMessagePosted`, fields: {
        escrow_id: bcs.Address,
        fee_message_id: bcs.Address,
        fee_inbox_id: bcs.Address,
        amount: bcs.u64(),
        coin_type: bcs.string()
    } });
export const FeeMessageCollected = new MoveStruct({ name: `${$moduleName}::FeeMessageCollected`, fields: {
        fee_message_id: bcs.Address,
        fee_inbox_id: bcs.Address,
        amount: bcs.u64(),
        collector: bcs.Address,
        coin_type: bcs.string()
    } });