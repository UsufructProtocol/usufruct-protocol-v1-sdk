/**************************************************************
 * THIS FILE IS GENERATED AND SHOULD NOT BE MANUALLY MODIFIED *
 **************************************************************/
import { type Transaction } from '@mysten/sui/transactions';
import { normalizeMoveArguments, type RawTransactionArgument } from '../utils/index.js';
export interface RenounceGovernanceArguments {
    cap: RawTransactionArgument<string>;
}
export interface RenounceGovernanceOptions {
    package?: string;
    arguments: RenounceGovernanceArguments | [
        cap: RawTransactionArgument<string>
    ];
}
export function renounceGovernance(options: RenounceGovernanceOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["cap"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'cap',
        function: 'renounce_governance',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
    });
}
export interface BurnUsufructCapArguments {
    cap: RawTransactionArgument<string>;
}
export interface BurnUsufructCapOptions {
    package?: string;
    arguments: BurnUsufructCapArguments | [
        cap: RawTransactionArgument<string>
    ];
}
export function burnUsufructCap(options: BurnUsufructCapOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["cap"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'cap',
        function: 'burn_usufruct_cap',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
    });
}
export interface UsufructCapEscrowIdArguments {
    cap: RawTransactionArgument<string>;
}
export interface UsufructCapEscrowIdOptions {
    package?: string;
    arguments: UsufructCapEscrowIdArguments | [
        cap: RawTransactionArgument<string>
    ];
}
export function usufructCapEscrowId(options: UsufructCapEscrowIdOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["cap"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'cap',
        function: 'usufruct_cap_escrow_id',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
    });
}