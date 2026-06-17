/**************************************************************
 * THIS FILE IS GENERATED AND SHOULD NOT BE MANUALLY MODIFIED *
 **************************************************************/
import { type Transaction, type TransactionArgument } from '@mysten/sui/transactions';
import { normalizeMoveArguments, type RawTransactionArgument } from '../utils/index.js';
export interface PriceArguments {
    mist: RawTransactionArgument<number | bigint>;
}
export interface PriceOptions {
    package?: string;
    arguments: PriceArguments | [
        mist: RawTransactionArgument<number | bigint>
    ];
}
export function price(options: PriceOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        'u64'
    ] satisfies (string | null)[];
    const parameterNames = ["mist"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'ensemble',
        function: 'price',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
    });
}
export interface DurationArguments {
    ms: RawTransactionArgument<number | bigint>;
}
export interface DurationOptions {
    package?: string;
    arguments: DurationArguments | [
        ms: RawTransactionArgument<number | bigint>
    ];
}
export function duration(options: DurationOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        'u64'
    ] satisfies (string | null)[];
    const parameterNames = ["ms"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'ensemble',
        function: 'duration',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
    });
}
export interface TenuresArguments {
    n: RawTransactionArgument<number | bigint>;
}
export interface TenuresOptions {
    package?: string;
    arguments: TenuresArguments | [
        n: RawTransactionArgument<number | bigint>
    ];
}
export function tenures(options: TenuresOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        'u64'
    ] satisfies (string | null)[];
    const parameterNames = ["n"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'ensemble',
        function: 'tenures',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
    });
}
export interface BasisPointsArguments {
    bps: RawTransactionArgument<number | bigint>;
}
export interface BasisPointsOptions {
    package?: string;
    arguments: BasisPointsArguments | [
        bps: RawTransactionArgument<number | bigint>
    ];
}
export function basisPoints(options: BasisPointsOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        'u64'
    ] satisfies (string | null)[];
    const parameterNames = ["bps"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'ensemble',
        function: 'basis_points',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
    });
}
export interface NewDescentOffOptions {
    package?: string;
    arguments?: [
    ];
}
export function newDescentOff(options: NewDescentOffOptions = {}) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'ensemble',
        function: 'new_descent_off',
    });
}
export interface NewDescentFixedArguments {
    ceiling: TransactionArgument;
}
export interface NewDescentFixedOptions {
    package?: string;
    arguments: NewDescentFixedArguments | [
        ceiling: TransactionArgument
    ];
}
export function newDescentFixed(options: NewDescentFixedOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["ceiling"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'ensemble',
        function: 'new_descent_fixed',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
    });
}
export interface NewRetireCommitmentImmediateOptions {
    package?: string;
    arguments?: [
    ];
}
export function newRetireCommitmentImmediate(options: NewRetireCommitmentImmediateOptions = {}) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'ensemble',
        function: 'new_retire_commitment_immediate',
    });
}
export interface NewRetireCommitmentDeferredArguments {
    floor: TransactionArgument;
}
export interface NewRetireCommitmentDeferredOptions {
    package?: string;
    arguments: NewRetireCommitmentDeferredArguments | [
        floor: TransactionArgument
    ];
}
export function newRetireCommitmentDeferred(options: NewRetireCommitmentDeferredOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["floor"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'ensemble',
        function: 'new_retire_commitment_deferred',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
    });
}
export interface NewEnsembleCommitmentImmediateOptions {
    package?: string;
    arguments?: [
    ];
}
export function newEnsembleCommitmentImmediate(options: NewEnsembleCommitmentImmediateOptions = {}) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'ensemble',
        function: 'new_ensemble_commitment_immediate',
    });
}
export interface NewEnsembleCommitmentDeferredArguments {
    floor: TransactionArgument;
}
export interface NewEnsembleCommitmentDeferredOptions {
    package?: string;
    arguments: NewEnsembleCommitmentDeferredArguments | [
        floor: TransactionArgument
    ];
}
export function newEnsembleCommitmentDeferred(options: NewEnsembleCommitmentDeferredOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["floor"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'ensemble',
        function: 'new_ensemble_commitment_deferred',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
    });
}
export interface NewLinearOptions {
    package?: string;
    arguments?: [
    ];
}
export function newLinear(options: NewLinearOptions = {}) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'ensemble',
        function: 'new_linear',
    });
}
export interface NewSmoothstepOptions {
    package?: string;
    arguments?: [
    ];
}
export function newSmoothstep(options: NewSmoothstepOptions = {}) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'ensemble',
        function: 'new_smoothstep',
    });
}
export interface NewLogisticOptions {
    package?: string;
    arguments?: [
    ];
}
export function newLogistic(options: NewLogisticOptions = {}) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'ensemble',
        function: 'new_logistic',
    });
}
export interface NewPowerLawArguments {
    alphaNum: RawTransactionArgument<number>;
    alphaDen: RawTransactionArgument<number>;
}
export interface NewPowerLawOptions {
    package?: string;
    arguments: NewPowerLawArguments | [
        alphaNum: RawTransactionArgument<number>,
        alphaDen: RawTransactionArgument<number>
    ];
}
export function newPowerLaw(options: NewPowerLawOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        'u8',
        'u8'
    ] satisfies (string | null)[];
    const parameterNames = ["alphaNum", "alphaDen"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'ensemble',
        function: 'new_power_law',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
    });
}
export interface NewExponentialArguments {
    alphaAbs: RawTransactionArgument<number>;
    alphaNeg: RawTransactionArgument<boolean>;
}
export interface NewExponentialOptions {
    package?: string;
    arguments: NewExponentialArguments | [
        alphaAbs: RawTransactionArgument<number>,
        alphaNeg: RawTransactionArgument<boolean>
    ];
}
export function newExponential(options: NewExponentialOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        'u8',
        'bool'
    ] satisfies (string | null)[];
    const parameterNames = ["alphaAbs", "alphaNeg"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'ensemble',
        function: 'new_exponential',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
    });
}
export interface NewHandoverOffOptions {
    package?: string;
    arguments?: [
    ];
}
export function newHandoverOff(options: NewHandoverOffOptions = {}) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'ensemble',
        function: 'new_handover_off',
    });
}
export interface NewHandoverFullTenureOptions {
    package?: string;
    arguments?: [
    ];
}
export function newHandoverFullTenure(options: NewHandoverFullTenureOptions = {}) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'ensemble',
        function: 'new_handover_full_tenure',
    });
}
export interface NewHandoverFixedArguments {
    floor: TransactionArgument;
}
export interface NewHandoverFixedOptions {
    package?: string;
    arguments: NewHandoverFixedArguments | [
        floor: TransactionArgument
    ];
}
export function newHandoverFixed(options: NewHandoverFixedOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["floor"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'ensemble',
        function: 'new_handover_fixed',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
    });
}
export interface NewPriceFixedDeltaArguments {
    delta: TransactionArgument;
}
export interface NewPriceFixedDeltaOptions {
    package?: string;
    arguments: NewPriceFixedDeltaArguments | [
        delta: TransactionArgument
    ];
}
export function newPriceFixedDelta(options: NewPriceFixedDeltaOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["delta"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'ensemble',
        function: 'new_price_fixed_delta',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
    });
}
export interface NewPriceCompoundDeltaArguments {
    bps: TransactionArgument;
    delta: TransactionArgument;
}
export interface NewPriceCompoundDeltaOptions {
    package?: string;
    arguments: NewPriceCompoundDeltaArguments | [
        bps: TransactionArgument,
        delta: TransactionArgument
    ];
}
export function newPriceCompoundDelta(options: NewPriceCompoundDeltaOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null,
        null
    ] satisfies (string | null)[];
    const parameterNames = ["bps", "delta"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'ensemble',
        function: 'new_price_compound_delta',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
    });
}
export interface NewRestPriceFixedArguments {
    price: TransactionArgument;
}
export interface NewRestPriceFixedOptions {
    package?: string;
    arguments: NewRestPriceFixedArguments | [
        price: TransactionArgument
    ];
}
export function newRestPriceFixed(options: NewRestPriceFixedOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["price"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'ensemble',
        function: 'new_rest_price_fixed',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
    });
}
export interface NewTenureDurationFixedArguments {
    ceiling: TransactionArgument;
}
export interface NewTenureDurationFixedOptions {
    package?: string;
    arguments: NewTenureDurationFixedArguments | [
        ceiling: TransactionArgument
    ];
}
export function newTenureDurationFixed(options: NewTenureDurationFixedOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["ceiling"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'ensemble',
        function: 'new_tenure_duration_fixed',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
    });
}
export interface NewTenureSingleOptions {
    package?: string;
    arguments?: [
    ];
}
export function newTenureSingle(options: NewTenureSingleOptions = {}) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'ensemble',
        function: 'new_tenure_single',
    });
}
export interface NewTenureMultiOptions {
    package?: string;
    arguments?: [
    ];
}
export function newTenureMulti(options: NewTenureMultiOptions = {}) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'ensemble',
        function: 'new_tenure_multi',
    });
}
export interface NewEnsembleArguments {
    restPrice: TransactionArgument;
    tenureDuration: TransactionArgument;
    tenureExtend: TransactionArgument;
    handover: TransactionArgument;
    auctionWindow: TransactionArgument;
    creditShape: TransactionArgument;
    auctionShape: TransactionArgument;
    priceEscalation: TransactionArgument;
}
export interface NewEnsembleOptions {
    package?: string;
    arguments: NewEnsembleArguments | [
        restPrice: TransactionArgument,
        tenureDuration: TransactionArgument,
        tenureExtend: TransactionArgument,
        handover: TransactionArgument,
        auctionWindow: TransactionArgument,
        creditShape: TransactionArgument,
        auctionShape: TransactionArgument,
        priceEscalation: TransactionArgument
    ];
}
export function newEnsemble(options: NewEnsembleOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null
    ] satisfies (string | null)[];
    const parameterNames = ["restPrice", "tenureDuration", "tenureExtend", "handover", "auctionWindow", "creditShape", "auctionShape", "priceEscalation"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'ensemble',
        function: 'new_ensemble',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
    });
}