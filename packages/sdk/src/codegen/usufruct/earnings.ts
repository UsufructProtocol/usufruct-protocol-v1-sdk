/**************************************************************
 * THIS FILE IS GENERATED AND SHOULD NOT BE MANUALLY MODIFIED *
 **************************************************************/
import { type Transaction, type TransactionArgument } from '@mysten/sui/transactions';
import { normalizeMoveArguments, type RawTransactionArgument } from '../utils/index.js';
export interface CollectEarningsMessagesArguments {
    inbox: RawTransactionArgument<string>;
    tickets: TransactionArgument;
}
export interface CollectEarningsMessagesOptions {
    package?: string;
    arguments: CollectEarningsMessagesArguments | [
        inbox: RawTransactionArgument<string>,
        tickets: TransactionArgument
    ];
    typeArguments: [
        string
    ];
}
export function collectEarningsMessages(options: CollectEarningsMessagesOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null,
        'vector<null>'
    ] satisfies (string | null)[];
    const parameterNames = ["inbox", "tickets"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'earnings',
        function: 'collect_earnings_messages',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}