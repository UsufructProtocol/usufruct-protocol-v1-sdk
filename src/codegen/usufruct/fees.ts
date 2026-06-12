/**************************************************************
 * THIS FILE IS GENERATED AND SHOULD NOT BE MANUALLY MODIFIED *
 **************************************************************/
import { type Transaction, type TransactionArgument } from '@mysten/sui/transactions';
import { normalizeMoveArguments, type RawTransactionArgument } from '../utils/index.js';
export interface CollectFeeMessagesArguments {
    inbox: RawTransactionArgument<string>;
    tickets: TransactionArgument;
}
export interface CollectFeeMessagesOptions {
    package?: string;
    arguments: CollectFeeMessagesArguments | [
        inbox: RawTransactionArgument<string>,
        tickets: TransactionArgument
    ];
    typeArguments: [
        string
    ];
}
export function collectFeeMessages(options: CollectFeeMessagesOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null,
        'vector<null>'
    ] satisfies (string | null)[];
    const parameterNames = ["inbox", "tickets"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'fees',
        function: 'collect_fee_messages',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface InboxIdArguments {
    feeRef: RawTransactionArgument<string>;
}
export interface InboxIdOptions {
    package?: string;
    arguments: InboxIdArguments | [
        feeRef: RawTransactionArgument<string>
    ];
}
export function inboxId(options: InboxIdOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["feeRef"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'fees',
        function: 'inbox_id',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
    });
}