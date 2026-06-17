/**************************************************************
 * THIS FILE IS GENERATED AND SHOULD NOT BE MANUALLY MODIFIED *
 **************************************************************/
import { type Transaction } from '@mysten/sui/transactions';
import { normalizeMoveArguments, type RawTransactionArgument } from '../utils/index.js';
export interface RefundAddressArguments {
    addr: RawTransactionArgument<string>;
}
export interface RefundAddressOptions {
    package?: string;
    arguments: RefundAddressArguments | [
        addr: RawTransactionArgument<string>
    ];
}
export function refundAddress(options: RefundAddressOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        'address'
    ] satisfies (string | null)[];
    const parameterNames = ["addr"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'refund',
        function: 'refund_address',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
    });
}