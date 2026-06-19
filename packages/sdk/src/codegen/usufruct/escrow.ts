/**************************************************************
 * THIS FILE IS GENERATED AND SHOULD NOT BE MANUALLY MODIFIED *
 **************************************************************/
import { type BcsType, bcs } from '@mysten/sui/bcs';
import { MoveStruct, normalizeMoveArguments, type RawTransactionArgument } from '../utils/index.js';
import { type Transaction, type TransactionArgument } from '@mysten/sui/transactions';
import * as asset_state from './asset_state.js';
const $moduleName = '@local-pkg/usufruct::escrow';
export function Escrow<Asset extends BcsType<any>>(...typeParameters: [
    Asset
]) {
    return new MoveStruct({ name: `${$moduleName}::Escrow<${typeParameters[0].name as Asset['name']}, phantom CoinType>`, fields: {
            id: bcs.Address,
            core: bcs.option(asset_state.EscrowCore),
            state: bcs.option(asset_state.AssetState(typeParameters[0]))
        } });
}
export interface IntegrateArguments<Asset extends BcsType<any>> {
    asset: RawTransactionArgument<Asset>;
    ensemble: TransactionArgument;
    retireCommitment: TransactionArgument;
    ensembleCommitment: TransactionArgument;
    feeRef: RawTransactionArgument<string>;
}
export interface IntegrateOptions<Asset extends BcsType<any>> {
    package?: string;
    arguments: IntegrateArguments<Asset> | [
        asset: RawTransactionArgument<Asset>,
        ensemble: TransactionArgument,
        retireCommitment: TransactionArgument,
        ensembleCommitment: TransactionArgument,
        feeRef: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function integrate<Asset extends BcsType<any>>(options: IntegrateOptions<Asset>) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        `${options.typeArguments[0]}`,
        null,
        null,
        null,
        null,
        '0x2::clock::Clock'
    ] satisfies (string | null)[];
    const parameterNames = ["asset", "ensemble", "retireCommitment", "ensembleCommitment", "feeRef"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'integrate',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface IntegrateIntoPortfolioArguments<Asset extends BcsType<any>> {
    asset: RawTransactionArgument<Asset>;
    ensemble: TransactionArgument;
    retireCommitment: TransactionArgument;
    ensembleCommitment: TransactionArgument;
    feeRef: RawTransactionArgument<string>;
    governanceCap: RawTransactionArgument<string>;
    inbox: RawTransactionArgument<string>;
}
export interface IntegrateIntoPortfolioOptions<Asset extends BcsType<any>> {
    package?: string;
    arguments: IntegrateIntoPortfolioArguments<Asset> | [
        asset: RawTransactionArgument<Asset>,
        ensemble: TransactionArgument,
        retireCommitment: TransactionArgument,
        ensembleCommitment: TransactionArgument,
        feeRef: RawTransactionArgument<string>,
        governanceCap: RawTransactionArgument<string>,
        inbox: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function integrateIntoPortfolio<Asset extends BcsType<any>>(options: IntegrateIntoPortfolioOptions<Asset>) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        `${options.typeArguments[0]}`,
        null,
        null,
        null,
        null,
        null,
        null,
        '0x2::clock::Clock'
    ] satisfies (string | null)[];
    const parameterNames = ["asset", "ensemble", "retireCommitment", "ensembleCommitment", "feeRef", "governanceCap", "inbox"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'integrate_into_portfolio',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface ClaimAssetArguments {
    escrow: RawTransactionArgument<string>;
    governanceCap: RawTransactionArgument<string>;
}
export interface ClaimAssetOptions {
    package?: string;
    arguments: ClaimAssetArguments | [
        escrow: RawTransactionArgument<string>,
        governanceCap: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function claimAsset(options: ClaimAssetOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null,
        null,
        '0x2::clock::Clock'
    ] satisfies (string | null)[];
    const parameterNames = ["escrow", "governanceCap"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'claim_asset',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface RetireArguments {
    escrow: RawTransactionArgument<string>;
    governanceCap: RawTransactionArgument<string>;
}
export interface RetireOptions {
    package?: string;
    arguments: RetireArguments | [
        escrow: RawTransactionArgument<string>,
        governanceCap: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function retire(options: RetireOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null,
        null,
        '0x2::clock::Clock'
    ] satisfies (string | null)[];
    const parameterNames = ["escrow", "governanceCap"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'retire',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface ExtendRetireCommitmentArguments {
    escrow: RawTransactionArgument<string>;
    governanceCap: RawTransactionArgument<string>;
    newPolicy: TransactionArgument;
}
export interface ExtendRetireCommitmentOptions {
    package?: string;
    arguments: ExtendRetireCommitmentArguments | [
        escrow: RawTransactionArgument<string>,
        governanceCap: RawTransactionArgument<string>,
        newPolicy: TransactionArgument
    ];
    typeArguments: [
        string,
        string
    ];
}
export function extendRetireCommitment(options: ExtendRetireCommitmentOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null,
        null,
        null,
        '0x2::clock::Clock'
    ] satisfies (string | null)[];
    const parameterNames = ["escrow", "governanceCap", "newPolicy"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'extend_retire_commitment',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface ExtendEnsembleCommitmentArguments {
    escrow: RawTransactionArgument<string>;
    governanceCap: RawTransactionArgument<string>;
    newPolicy: TransactionArgument;
}
export interface ExtendEnsembleCommitmentOptions {
    package?: string;
    arguments: ExtendEnsembleCommitmentArguments | [
        escrow: RawTransactionArgument<string>,
        governanceCap: RawTransactionArgument<string>,
        newPolicy: TransactionArgument
    ];
    typeArguments: [
        string,
        string
    ];
}
export function extendEnsembleCommitment(options: ExtendEnsembleCommitmentOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null,
        null,
        null,
        '0x2::clock::Clock'
    ] satisfies (string | null)[];
    const parameterNames = ["escrow", "governanceCap", "newPolicy"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'extend_ensemble_commitment',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface UpdateEnsembleArguments {
    escrow: RawTransactionArgument<string>;
    governanceCap: RawTransactionArgument<string>;
    newEnsemble: TransactionArgument;
}
export interface UpdateEnsembleOptions {
    package?: string;
    arguments: UpdateEnsembleArguments | [
        escrow: RawTransactionArgument<string>,
        governanceCap: RawTransactionArgument<string>,
        newEnsemble: TransactionArgument
    ];
    typeArguments: [
        string,
        string
    ];
}
export function updateEnsemble(options: UpdateEnsembleOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null,
        null,
        null,
        '0x2::clock::Clock'
    ] satisfies (string | null)[];
    const parameterNames = ["escrow", "governanceCap", "newEnsemble"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'update_ensemble',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface RentArguments {
    escrow: RawTransactionArgument<string>;
    payment: RawTransactionArgument<string>;
    tenures: TransactionArgument;
}
export interface RentOptions {
    package?: string;
    arguments: RentArguments | [
        escrow: RawTransactionArgument<string>,
        payment: RawTransactionArgument<string>,
        tenures: TransactionArgument
    ];
    typeArguments: [
        string,
        string
    ];
}
export function rent(options: RentOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null,
        null,
        null,
        '0x2::clock::Clock'
    ] satisfies (string | null)[];
    const parameterNames = ["escrow", "payment", "tenures"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'rent',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface BorrowAssetArguments {
    escrow: RawTransactionArgument<string>;
    usufructCap: RawTransactionArgument<string>;
}
export interface BorrowAssetOptions {
    package?: string;
    arguments: BorrowAssetArguments | [
        escrow: RawTransactionArgument<string>,
        usufructCap: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function borrowAsset(options: BorrowAssetOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null,
        null,
        '0x2::clock::Clock'
    ] satisfies (string | null)[];
    const parameterNames = ["escrow", "usufructCap"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'borrow_asset',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface ReturnAssetArguments<Asset extends BcsType<any>> {
    escrow: RawTransactionArgument<string>;
    asset: RawTransactionArgument<Asset>;
    receiptIn: TransactionArgument;
}
export interface ReturnAssetOptions<Asset extends BcsType<any>> {
    package?: string;
    arguments: ReturnAssetArguments<Asset> | [
        escrow: RawTransactionArgument<string>,
        asset: RawTransactionArgument<Asset>,
        receiptIn: TransactionArgument
    ];
    typeArguments: [
        string,
        string
    ];
}
export function returnAsset<Asset extends BcsType<any>>(options: ReturnAssetOptions<Asset>) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null,
        `${options.typeArguments[0]}`,
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow", "asset", "receiptIn"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'return_asset',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface BurnStaleUsufructCapArguments {
    escrow: RawTransactionArgument<string>;
    cap: RawTransactionArgument<string>;
}
export interface BurnStaleUsufructCapOptions {
    package?: string;
    arguments: BurnStaleUsufructCapArguments | [
        escrow: RawTransactionArgument<string>,
        cap: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function burnStaleUsufructCap(options: BurnStaleUsufructCapOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null,
        null,
        '0x2::clock::Clock'
    ] satisfies (string | null)[];
    const parameterNames = ["escrow", "cap"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'burn_stale_usufruct_cap',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface UpdateUsufructuaryRefundAddressArguments {
    escrow: RawTransactionArgument<string>;
    cap: RawTransactionArgument<string>;
    newAddress: TransactionArgument;
}
export interface UpdateUsufructuaryRefundAddressOptions {
    package?: string;
    arguments: UpdateUsufructuaryRefundAddressArguments | [
        escrow: RawTransactionArgument<string>,
        cap: RawTransactionArgument<string>,
        newAddress: TransactionArgument
    ];
    typeArguments: [
        string,
        string
    ];
}
export function updateUsufructuaryRefundAddress(options: UpdateUsufructuaryRefundAddressOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null,
        null,
        null,
        '0x2::clock::Clock'
    ] satisfies (string | null)[];
    const parameterNames = ["escrow", "cap", "newAddress"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'update_usufructuary_refund_address',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface ApplyPendingTransitionStatesArguments {
    escrow: RawTransactionArgument<string>;
}
export interface ApplyPendingTransitionStatesOptions {
    package?: string;
    arguments: ApplyPendingTransitionStatesArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function applyPendingTransitionStates(options: ApplyPendingTransitionStatesOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null,
        '0x2::clock::Clock'
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'apply_pending_transition_states',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface IsIdleArguments {
    escrow: RawTransactionArgument<string>;
}
export interface IsIdleOptions {
    package?: string;
    arguments: IsIdleArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function isIdle(options: IsIdleOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'is_idle',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface IsDescendingArguments {
    escrow: RawTransactionArgument<string>;
}
export interface IsDescendingOptions {
    package?: string;
    arguments: IsDescendingArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function isDescending(options: IsDescendingOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'is_descending',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface IsOccupiedArguments {
    escrow: RawTransactionArgument<string>;
}
export interface IsOccupiedOptions {
    package?: string;
    arguments: IsOccupiedArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function isOccupied(options: IsOccupiedOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'is_occupied',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface IsDemandArguments {
    escrow: RawTransactionArgument<string>;
}
export interface IsDemandOptions {
    package?: string;
    arguments: IsDemandArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function isDemand(options: IsDemandOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'is_demand',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface IsLiveArguments {
    escrow: RawTransactionArgument<string>;
}
export interface IsLiveOptions {
    package?: string;
    arguments: IsLiveArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function isLive(options: IsLiveOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'is_live',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface IsRetiredArguments {
    escrow: RawTransactionArgument<string>;
}
export interface IsRetiredOptions {
    package?: string;
    arguments: IsRetiredArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function isRetired(options: IsRetiredOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'is_retired',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface IsRentedArguments {
    escrow: RawTransactionArgument<string>;
}
export interface IsRentedOptions {
    package?: string;
    arguments: IsRentedArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function isRented(options: IsRentedOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'is_rented',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface AuctionWindowIsOffArguments {
    escrow: RawTransactionArgument<string>;
}
export interface AuctionWindowIsOffOptions {
    package?: string;
    arguments: AuctionWindowIsOffArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function auctionWindowIsOff(options: AuctionWindowIsOffOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'auction_window_is_off',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface AuctionWindowIsFixedArguments {
    escrow: RawTransactionArgument<string>;
}
export interface AuctionWindowIsFixedOptions {
    package?: string;
    arguments: AuctionWindowIsFixedArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function auctionWindowIsFixed(options: AuctionWindowIsFixedOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'auction_window_is_fixed',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface RetireCommitmentIsImmediateArguments {
    escrow: RawTransactionArgument<string>;
}
export interface RetireCommitmentIsImmediateOptions {
    package?: string;
    arguments: RetireCommitmentIsImmediateArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function retireCommitmentIsImmediate(options: RetireCommitmentIsImmediateOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'retire_commitment_is_immediate',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface RetireCommitmentIsDeferredArguments {
    escrow: RawTransactionArgument<string>;
}
export interface RetireCommitmentIsDeferredOptions {
    package?: string;
    arguments: RetireCommitmentIsDeferredArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function retireCommitmentIsDeferred(options: RetireCommitmentIsDeferredOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'retire_commitment_is_deferred',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface HandoverIsOffArguments {
    escrow: RawTransactionArgument<string>;
}
export interface HandoverIsOffOptions {
    package?: string;
    arguments: HandoverIsOffArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function handoverIsOff(options: HandoverIsOffOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'handover_is_off',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface HandoverIsFullTenureArguments {
    escrow: RawTransactionArgument<string>;
}
export interface HandoverIsFullTenureOptions {
    package?: string;
    arguments: HandoverIsFullTenureArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function handoverIsFullTenure(options: HandoverIsFullTenureOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'handover_is_full_tenure',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface HandoverIsFixedArguments {
    escrow: RawTransactionArgument<string>;
}
export interface HandoverIsFixedOptions {
    package?: string;
    arguments: HandoverIsFixedArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function handoverIsFixed(options: HandoverIsFixedOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'handover_is_fixed',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface IsRetiringArguments {
    escrow: RawTransactionArgument<string>;
}
export interface IsRetiringOptions {
    package?: string;
    arguments: IsRetiringArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function isRetiring(options: IsRetiringOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'is_retiring',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface AssetIdArguments {
    escrow: RawTransactionArgument<string>;
}
export interface AssetIdOptions {
    package?: string;
    arguments: AssetIdArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function assetId(options: AssetIdOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'asset_id',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface AssetTypeNameArguments {
    Escrow: RawTransactionArgument<string>;
}
export interface AssetTypeNameOptions {
    package?: string;
    arguments: AssetTypeNameArguments | [
        Escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function assetTypeName(options: AssetTypeNameOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["Escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'asset_type_name',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface CoinTypeNameArguments {
    Escrow: RawTransactionArgument<string>;
}
export interface CoinTypeNameOptions {
    package?: string;
    arguments: CoinTypeNameArguments | [
        Escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function coinTypeName(options: CoinTypeNameOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["Escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'coin_type_name',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface GovernanceCapIdArguments {
    escrow: RawTransactionArgument<string>;
}
export interface GovernanceCapIdOptions {
    package?: string;
    arguments: GovernanceCapIdArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function governanceCapId(options: GovernanceCapIdOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'governance_cap_id',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface ActiveUsufructuaryAddrArguments {
    escrow: RawTransactionArgument<string>;
}
export interface ActiveUsufructuaryAddrOptions {
    package?: string;
    arguments: ActiveUsufructuaryAddrArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function activeUsufructuaryAddr(options: ActiveUsufructuaryAddrOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'active_usufructuary_addr',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface ActiveUsufructCapIdArguments {
    escrow: RawTransactionArgument<string>;
}
export interface ActiveUsufructCapIdOptions {
    package?: string;
    arguments: ActiveUsufructCapIdArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function activeUsufructCapId(options: ActiveUsufructCapIdOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'active_usufruct_cap_id',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface PendingUsufructuaryAddrArguments {
    escrow: RawTransactionArgument<string>;
}
export interface PendingUsufructuaryAddrOptions {
    package?: string;
    arguments: PendingUsufructuaryAddrArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function pendingUsufructuaryAddr(options: PendingUsufructuaryAddrOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'pending_usufructuary_addr',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface PendingUsufructCapIdArguments {
    escrow: RawTransactionArgument<string>;
}
export interface PendingUsufructCapIdOptions {
    package?: string;
    arguments: PendingUsufructCapIdArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function pendingUsufructCapId(options: PendingUsufructCapIdOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'pending_usufruct_cap_id',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface ActiveStakeBalanceMistArguments {
    escrow: RawTransactionArgument<string>;
}
export interface ActiveStakeBalanceMistOptions {
    package?: string;
    arguments: ActiveStakeBalanceMistArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function activeStakeBalanceMist(options: ActiveStakeBalanceMistOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'active_stake_balance_mist',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface PendingStakeBalanceMistArguments {
    escrow: RawTransactionArgument<string>;
}
export interface PendingStakeBalanceMistOptions {
    package?: string;
    arguments: PendingStakeBalanceMistArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function pendingStakeBalanceMist(options: PendingStakeBalanceMistOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'pending_stake_balance_mist',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface ActiveUsufructuaryCommittedTenuresArguments {
    escrow: RawTransactionArgument<string>;
}
export interface ActiveUsufructuaryCommittedTenuresOptions {
    package?: string;
    arguments: ActiveUsufructuaryCommittedTenuresArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function activeUsufructuaryCommittedTenures(options: ActiveUsufructuaryCommittedTenuresOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'active_usufructuary_committed_tenures',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface PendingUsufructuaryCommittedTenuresArguments {
    escrow: RawTransactionArgument<string>;
}
export interface PendingUsufructuaryCommittedTenuresOptions {
    package?: string;
    arguments: PendingUsufructuaryCommittedTenuresArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function pendingUsufructuaryCommittedTenures(options: PendingUsufructuaryCommittedTenuresOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'pending_usufructuary_committed_tenures',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface PhaseStartMsArguments {
    escrow: RawTransactionArgument<string>;
}
export interface PhaseStartMsOptions {
    package?: string;
    arguments: PhaseStartMsArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function phaseStartMs(options: PhaseStartMsOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'phase_start_ms',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface TenureExpiryMsArguments {
    escrow: RawTransactionArgument<string>;
}
export interface TenureExpiryMsOptions {
    package?: string;
    arguments: TenureExpiryMsArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function tenureExpiryMs(options: TenureExpiryMsOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'tenure_expiry_ms',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface ActiveEnsembleFloorPriceMistArguments {
    escrow: RawTransactionArgument<string>;
}
export interface ActiveEnsembleFloorPriceMistOptions {
    package?: string;
    arguments: ActiveEnsembleFloorPriceMistArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function activeEnsembleFloorPriceMist(options: ActiveEnsembleFloorPriceMistOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'active_ensemble_floor_price_mist',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface ActiveEnsembleCeilingMsArguments {
    escrow: RawTransactionArgument<string>;
}
export interface ActiveEnsembleCeilingMsOptions {
    package?: string;
    arguments: ActiveEnsembleCeilingMsArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function activeEnsembleCeilingMs(options: ActiveEnsembleCeilingMsOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'active_ensemble_ceiling_ms',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface ActiveEnsembleHandoverMsArguments {
    escrow: RawTransactionArgument<string>;
}
export interface ActiveEnsembleHandoverMsOptions {
    package?: string;
    arguments: ActiveEnsembleHandoverMsArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function activeEnsembleHandoverMs(options: ActiveEnsembleHandoverMsOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'active_ensemble_handover_ms',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface ActiveEnsembleDescentMsArguments {
    escrow: RawTransactionArgument<string>;
}
export interface ActiveEnsembleDescentMsOptions {
    package?: string;
    arguments: ActiveEnsembleDescentMsArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function activeEnsembleDescentMs(options: ActiveEnsembleDescentMsOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'active_ensemble_descent_ms',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface ActiveCeilingTotalMsArguments {
    escrow: RawTransactionArgument<string>;
}
export interface ActiveCeilingTotalMsOptions {
    package?: string;
    arguments: ActiveCeilingTotalMsArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function activeCeilingTotalMs(options: ActiveCeilingTotalMsOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'active_ceiling_total_ms',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface ActiveHandoverTotalMsArguments {
    escrow: RawTransactionArgument<string>;
}
export interface ActiveHandoverTotalMsOptions {
    package?: string;
    arguments: ActiveHandoverTotalMsArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function activeHandoverTotalMs(options: ActiveHandoverTotalMsOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'active_handover_total_ms',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface PendingEnsembleFloorPriceMistArguments {
    escrow: RawTransactionArgument<string>;
}
export interface PendingEnsembleFloorPriceMistOptions {
    package?: string;
    arguments: PendingEnsembleFloorPriceMistArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function pendingEnsembleFloorPriceMist(options: PendingEnsembleFloorPriceMistOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'pending_ensemble_floor_price_mist',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface PendingEnsembleCeilingMsArguments {
    escrow: RawTransactionArgument<string>;
}
export interface PendingEnsembleCeilingMsOptions {
    package?: string;
    arguments: PendingEnsembleCeilingMsArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function pendingEnsembleCeilingMs(options: PendingEnsembleCeilingMsOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'pending_ensemble_ceiling_ms',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface PendingEnsembleHandoverMsArguments {
    escrow: RawTransactionArgument<string>;
}
export interface PendingEnsembleHandoverMsOptions {
    package?: string;
    arguments: PendingEnsembleHandoverMsArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function pendingEnsembleHandoverMs(options: PendingEnsembleHandoverMsOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'pending_ensemble_handover_ms',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface PendingEnsembleDescentMsArguments {
    escrow: RawTransactionArgument<string>;
}
export interface PendingEnsembleDescentMsOptions {
    package?: string;
    arguments: PendingEnsembleDescentMsArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function pendingEnsembleDescentMs(options: PendingEnsembleDescentMsOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'pending_ensemble_descent_ms',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface NextEnsembleFloorPriceMistArguments {
    escrow: RawTransactionArgument<string>;
}
export interface NextEnsembleFloorPriceMistOptions {
    package?: string;
    arguments: NextEnsembleFloorPriceMistArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function nextEnsembleFloorPriceMist(options: NextEnsembleFloorPriceMistOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'next_ensemble_floor_price_mist',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface NextEnsembleCeilingMsArguments {
    escrow: RawTransactionArgument<string>;
}
export interface NextEnsembleCeilingMsOptions {
    package?: string;
    arguments: NextEnsembleCeilingMsArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function nextEnsembleCeilingMs(options: NextEnsembleCeilingMsOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'next_ensemble_ceiling_ms',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface NextEnsembleHandoverMsArguments {
    escrow: RawTransactionArgument<string>;
}
export interface NextEnsembleHandoverMsOptions {
    package?: string;
    arguments: NextEnsembleHandoverMsArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function nextEnsembleHandoverMs(options: NextEnsembleHandoverMsOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'next_ensemble_handover_ms',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface NextEnsembleDescentMsArguments {
    escrow: RawTransactionArgument<string>;
}
export interface NextEnsembleDescentMsOptions {
    package?: string;
    arguments: NextEnsembleDescentMsArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function nextEnsembleDescentMs(options: NextEnsembleDescentMsOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'next_ensemble_descent_ms',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface HandoverExpiryMsArguments {
    escrow: RawTransactionArgument<string>;
}
export interface HandoverExpiryMsOptions {
    package?: string;
    arguments: HandoverExpiryMsArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function handoverExpiryMs(options: HandoverExpiryMsOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'handover_expiry_ms',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface DescentExpiryMsArguments {
    escrow: RawTransactionArgument<string>;
}
export interface DescentExpiryMsOptions {
    package?: string;
    arguments: DescentExpiryMsArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function descentExpiryMs(options: DescentExpiryMsOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'descent_expiry_ms',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface ActiveUsufructuaryTimeRemainingMsArguments {
    escrow: RawTransactionArgument<string>;
    nowMs: RawTransactionArgument<number | bigint>;
}
export interface ActiveUsufructuaryTimeRemainingMsOptions {
    package?: string;
    arguments: ActiveUsufructuaryTimeRemainingMsArguments | [
        escrow: RawTransactionArgument<string>,
        nowMs: RawTransactionArgument<number | bigint>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function activeUsufructuaryTimeRemainingMs(options: ActiveUsufructuaryTimeRemainingMsOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null,
        'u64'
    ] satisfies (string | null)[];
    const parameterNames = ["escrow", "nowMs"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'active_usufructuary_time_remaining_ms',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface ActiveStakeBalanceRemainingMistArguments {
    escrow: RawTransactionArgument<string>;
    nowMs: RawTransactionArgument<number | bigint>;
}
export interface ActiveStakeBalanceRemainingMistOptions {
    package?: string;
    arguments: ActiveStakeBalanceRemainingMistArguments | [
        escrow: RawTransactionArgument<string>,
        nowMs: RawTransactionArgument<number | bigint>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function activeStakeBalanceRemainingMist(options: ActiveStakeBalanceRemainingMistOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null,
        'u64'
    ] satisfies (string | null)[];
    const parameterNames = ["escrow", "nowMs"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'active_stake_balance_remaining_mist',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface HandoverExpiryIfBidAtArguments {
    escrow: RawTransactionArgument<string>;
    bidTimeMs: RawTransactionArgument<number | bigint>;
}
export interface HandoverExpiryIfBidAtOptions {
    package?: string;
    arguments: HandoverExpiryIfBidAtArguments | [
        escrow: RawTransactionArgument<string>,
        bidTimeMs: RawTransactionArgument<number | bigint>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function handoverExpiryIfBidAt(options: HandoverExpiryIfBidAtOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null,
        'u64'
    ] satisfies (string | null)[];
    const parameterNames = ["escrow", "bidTimeMs"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'handover_expiry_if_bid_at',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface TenureCeilingMsArguments {
    escrow: RawTransactionArgument<string>;
}
export interface TenureCeilingMsOptions {
    package?: string;
    arguments: TenureCeilingMsArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function tenureCeilingMs(options: TenureCeilingMsOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'tenure_ceiling_ms',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface IntegratedAtMsArguments {
    escrow: RawTransactionArgument<string>;
}
export interface IntegratedAtMsOptions {
    package?: string;
    arguments: IntegratedAtMsArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function integratedAtMs(options: IntegratedAtMsOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'integrated_at_ms',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface RetireCommitmentUnlocksAtMsArguments {
    escrow: RawTransactionArgument<string>;
}
export interface RetireCommitmentUnlocksAtMsOptions {
    package?: string;
    arguments: RetireCommitmentUnlocksAtMsArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function retireCommitmentUnlocksAtMs(options: RetireCommitmentUnlocksAtMsOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'retire_commitment_unlocks_at_ms',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface RetireCommitmentAnchorMsArguments {
    escrow: RawTransactionArgument<string>;
}
export interface RetireCommitmentAnchorMsOptions {
    package?: string;
    arguments: RetireCommitmentAnchorMsArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function retireCommitmentAnchorMs(options: RetireCommitmentAnchorMsOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'retire_commitment_anchor_ms',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface RetireCommitmentRemainingMsArguments {
    escrow: RawTransactionArgument<string>;
    nowMs: RawTransactionArgument<number | bigint>;
}
export interface RetireCommitmentRemainingMsOptions {
    package?: string;
    arguments: RetireCommitmentRemainingMsArguments | [
        escrow: RawTransactionArgument<string>,
        nowMs: RawTransactionArgument<number | bigint>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function retireCommitmentRemainingMs(options: RetireCommitmentRemainingMsOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null,
        'u64'
    ] satisfies (string | null)[];
    const parameterNames = ["escrow", "nowMs"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'retire_commitment_remaining_ms',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface GovernanceCapIsValidArguments {
    escrow: RawTransactionArgument<string>;
    capId: RawTransactionArgument<string>;
}
export interface GovernanceCapIsValidOptions {
    package?: string;
    arguments: GovernanceCapIsValidArguments | [
        escrow: RawTransactionArgument<string>,
        capId: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function governanceCapIsValid(options: GovernanceCapIsValidOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null,
        '0x2::object::ID'
    ] satisfies (string | null)[];
    const parameterNames = ["escrow", "capId"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'governance_cap_is_valid',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface UsufructCapIsActiveArguments {
    escrow: RawTransactionArgument<string>;
    capId: RawTransactionArgument<string>;
}
export interface UsufructCapIsActiveOptions {
    package?: string;
    arguments: UsufructCapIsActiveArguments | [
        escrow: RawTransactionArgument<string>,
        capId: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function usufructCapIsActive(options: UsufructCapIsActiveOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null,
        '0x2::object::ID'
    ] satisfies (string | null)[];
    const parameterNames = ["escrow", "capId"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'usufruct_cap_is_active',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface UsufructCapIsPendingArguments {
    escrow: RawTransactionArgument<string>;
    capId: RawTransactionArgument<string>;
}
export interface UsufructCapIsPendingOptions {
    package?: string;
    arguments: UsufructCapIsPendingArguments | [
        escrow: RawTransactionArgument<string>,
        capId: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function usufructCapIsPending(options: UsufructCapIsPendingOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null,
        '0x2::object::ID'
    ] satisfies (string | null)[];
    const parameterNames = ["escrow", "capId"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'usufruct_cap_is_pending',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface UsufructCapIsStaleArguments {
    escrow: RawTransactionArgument<string>;
    capId: RawTransactionArgument<string>;
}
export interface UsufructCapIsStaleOptions {
    package?: string;
    arguments: UsufructCapIsStaleArguments | [
        escrow: RawTransactionArgument<string>,
        capId: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function usufructCapIsStale(options: UsufructCapIsStaleOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null,
        '0x2::object::ID'
    ] satisfies (string | null)[];
    const parameterNames = ["escrow", "capId"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'usufruct_cap_is_stale',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface TransitionIsReadyArguments {
    escrow: RawTransactionArgument<string>;
    nowMs: RawTransactionArgument<number | bigint>;
}
export interface TransitionIsReadyOptions {
    package?: string;
    arguments: TransitionIsReadyArguments | [
        escrow: RawTransactionArgument<string>,
        nowMs: RawTransactionArgument<number | bigint>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function transitionIsReady(options: TransitionIsReadyOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null,
        'u64'
    ] satisfies (string | null)[];
    const parameterNames = ["escrow", "nowMs"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'transition_is_ready',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface NextTransitionMsArguments {
    escrow: RawTransactionArgument<string>;
    nowMs: RawTransactionArgument<number | bigint>;
}
export interface NextTransitionMsOptions {
    package?: string;
    arguments: NextTransitionMsArguments | [
        escrow: RawTransactionArgument<string>,
        nowMs: RawTransactionArgument<number | bigint>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function nextTransitionMs(options: NextTransitionMsOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null,
        'u64'
    ] satisfies (string | null)[];
    const parameterNames = ["escrow", "nowMs"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'next_transition_ms',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface NextBoundaryMsArguments {
    escrow: RawTransactionArgument<string>;
}
export interface NextBoundaryMsOptions {
    package?: string;
    arguments: NextBoundaryMsArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function nextBoundaryMs(options: NextBoundaryMsOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'next_boundary_ms',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface AccruedCreditMistArguments {
    escrow: RawTransactionArgument<string>;
    nowMs: RawTransactionArgument<number | bigint>;
}
export interface AccruedCreditMistOptions {
    package?: string;
    arguments: AccruedCreditMistArguments | [
        escrow: RawTransactionArgument<string>,
        nowMs: RawTransactionArgument<number | bigint>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function accruedCreditMist(options: AccruedCreditMistOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null,
        'u64'
    ] satisfies (string | null)[];
    const parameterNames = ["escrow", "nowMs"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'accrued_credit_mist',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface FloorPriceMistArguments {
    escrow: RawTransactionArgument<string>;
    nowMs: RawTransactionArgument<number | bigint>;
}
export interface FloorPriceMistOptions {
    package?: string;
    arguments: FloorPriceMistArguments | [
        escrow: RawTransactionArgument<string>,
        nowMs: RawTransactionArgument<number | bigint>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function floorPriceMist(options: FloorPriceMistOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null,
        'u64'
    ] satisfies (string | null)[];
    const parameterNames = ["escrow", "nowMs"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'floor_price_mist',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface NextFloorPriceMistArguments {
    escrow: RawTransactionArgument<string>;
    totalBidMist: RawTransactionArgument<number | bigint>;
    tenures: RawTransactionArgument<number | bigint>;
}
export interface NextFloorPriceMistOptions {
    package?: string;
    arguments: NextFloorPriceMistArguments | [
        escrow: RawTransactionArgument<string>,
        totalBidMist: RawTransactionArgument<number | bigint>,
        tenures: RawTransactionArgument<number | bigint>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function nextFloorPriceMist(options: NextFloorPriceMistOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null,
        'u64',
        'u64'
    ] satisfies (string | null)[];
    const parameterNames = ["escrow", "totalBidMist", "tenures"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'next_floor_price_mist',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface DescentFloorAtArguments {
    lastAcqPriceMist: RawTransactionArgument<number | bigint>;
    phaseStartMs: RawTransactionArgument<number | bigint>;
    resolvedFloorMist: RawTransactionArgument<number | bigint>;
    resolvedDescentMs: RawTransactionArgument<number | bigint>;
    shape: TransactionArgument;
    nowMs: RawTransactionArgument<number | bigint>;
}
export interface DescentFloorAtOptions {
    package?: string;
    arguments: DescentFloorAtArguments | [
        lastAcqPriceMist: RawTransactionArgument<number | bigint>,
        phaseStartMs: RawTransactionArgument<number | bigint>,
        resolvedFloorMist: RawTransactionArgument<number | bigint>,
        resolvedDescentMs: RawTransactionArgument<number | bigint>,
        shape: TransactionArgument,
        nowMs: RawTransactionArgument<number | bigint>
    ];
}
export function descentFloorAt(options: DescentFloorAtOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        'u64',
        'u64',
        'u64',
        'u64',
        null,
        'u64'
    ] satisfies (string | null)[];
    const parameterNames = ["lastAcqPriceMist", "phaseStartMs", "resolvedFloorMist", "resolvedDescentMs", "shape", "nowMs"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'descent_floor_at',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
    });
}
export interface UsedCreditAtArguments {
    stakeMist: RawTransactionArgument<number | bigint>;
    phaseStartMs: RawTransactionArgument<number | bigint>;
    resolvedCeilingMs: RawTransactionArgument<number | bigint>;
    shape: TransactionArgument;
    nowMs: RawTransactionArgument<number | bigint>;
}
export interface UsedCreditAtOptions {
    package?: string;
    arguments: UsedCreditAtArguments | [
        stakeMist: RawTransactionArgument<number | bigint>,
        phaseStartMs: RawTransactionArgument<number | bigint>,
        resolvedCeilingMs: RawTransactionArgument<number | bigint>,
        shape: TransactionArgument,
        nowMs: RawTransactionArgument<number | bigint>
    ];
}
export function usedCreditAt(options: UsedCreditAtOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        'u64',
        'u64',
        'u64',
        null,
        'u64'
    ] satisfies (string | null)[];
    const parameterNames = ["stakeMist", "phaseStartMs", "resolvedCeilingMs", "shape", "nowMs"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'used_credit_at',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
    });
}
export interface AscendingFloorWithArguments {
    totalBidMist: RawTransactionArgument<number | bigint>;
    tenures: RawTransactionArgument<number | bigint>;
    escalation: TransactionArgument;
}
export interface AscendingFloorWithOptions {
    package?: string;
    arguments: AscendingFloorWithArguments | [
        totalBidMist: RawTransactionArgument<number | bigint>,
        tenures: RawTransactionArgument<number | bigint>,
        escalation: TransactionArgument
    ];
}
export function ascendingFloorWith(options: AscendingFloorWithOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        'u64',
        'u64',
        null
    ] satisfies (string | null)[];
    const parameterNames = ["totalBidMist", "tenures", "escalation"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'ascending_floor_with',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
    });
}
export interface LastRentPriceMistArguments {
    escrow: RawTransactionArgument<string>;
}
export interface LastRentPriceMistOptions {
    package?: string;
    arguments: LastRentPriceMistArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function lastRentPriceMist(options: LastRentPriceMistOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'last_rent_price_mist',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface CreditIsAccruingArguments {
    escrow: RawTransactionArgument<string>;
}
export interface CreditIsAccruingOptions {
    package?: string;
    arguments: CreditIsAccruingArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function creditIsAccruing(options: CreditIsAccruingOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'credit_is_accruing',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface CreditIsCappedArguments {
    escrow: RawTransactionArgument<string>;
}
export interface CreditIsCappedOptions {
    package?: string;
    arguments: CreditIsCappedArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function creditIsCapped(options: CreditIsCappedOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'credit_is_capped',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface CreditCappedAtMsArguments {
    escrow: RawTransactionArgument<string>;
}
export interface CreditCappedAtMsOptions {
    package?: string;
    arguments: CreditCappedAtMsArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function creditCappedAtMs(options: CreditCappedAtMsOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'credit_capped_at_ms',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface HandoverSettlementArguments {
    escrow: RawTransactionArgument<string>;
    boundaryMs: RawTransactionArgument<number | bigint>;
}
export interface HandoverSettlementOptions {
    package?: string;
    arguments: HandoverSettlementArguments | [
        escrow: RawTransactionArgument<string>,
        boundaryMs: RawTransactionArgument<number | bigint>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function handoverSettlement(options: HandoverSettlementOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null,
        'u64'
    ] satisfies (string | null)[];
    const parameterNames = ["escrow", "boundaryMs"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'handover_settlement',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface TenureSettlementArguments {
    escrow: RawTransactionArgument<string>;
}
export interface TenureSettlementOptions {
    package?: string;
    arguments: TenureSettlementArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function tenureSettlement(options: TenureSettlementOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'tenure_settlement',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface EarningsInboxIdArguments {
    escrow: RawTransactionArgument<string>;
}
export interface EarningsInboxIdOptions {
    package?: string;
    arguments: EarningsInboxIdArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function earningsInboxId(options: EarningsInboxIdOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'earnings_inbox_id',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface ActiveEnsembleArguments {
    escrow: RawTransactionArgument<string>;
}
export interface ActiveEnsembleOptions {
    package?: string;
    arguments: ActiveEnsembleArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function activeEnsemble(options: ActiveEnsembleOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'active_ensemble',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface FeeInboxIdArguments {
    escrow: RawTransactionArgument<string>;
}
export interface FeeInboxIdOptions {
    package?: string;
    arguments: FeeInboxIdArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function feeInboxId(options: FeeInboxIdOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'fee_inbox_id',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface HasPendingEnsembleUpdateArguments {
    escrow: RawTransactionArgument<string>;
}
export interface HasPendingEnsembleUpdateOptions {
    package?: string;
    arguments: HasPendingEnsembleUpdateArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function hasPendingEnsembleUpdate(options: HasPendingEnsembleUpdateOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'has_pending_ensemble_update',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface PendingEnsembleArguments {
    escrow: RawTransactionArgument<string>;
}
export interface PendingEnsembleOptions {
    package?: string;
    arguments: PendingEnsembleArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function pendingEnsemble(options: PendingEnsembleOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'pending_ensemble',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface ProtocolFeeBpsOptions {
    package?: string;
    arguments?: [
    ];
}
export function protocolFeeBps(options: ProtocolFeeBpsOptions = {}) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'protocol_fee_bps',
    });
}
export interface BpsDenominatorOptions {
    package?: string;
    arguments?: [
    ];
}
export function bpsDenominator(options: BpsDenominatorOptions = {}) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'bps_denominator',
    });
}
export interface RestPriceFloorMistArguments {
    escrow: RawTransactionArgument<string>;
}
export interface RestPriceFloorMistOptions {
    package?: string;
    arguments: RestPriceFloorMistArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function restPriceFloorMist(options: RestPriceFloorMistOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'rest_price_floor_mist',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface DescentCeilingMsArguments {
    escrow: RawTransactionArgument<string>;
}
export interface DescentCeilingMsOptions {
    package?: string;
    arguments: DescentCeilingMsArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function descentCeilingMs(options: DescentCeilingMsOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'descent_ceiling_ms',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface HandoverFloorMsArguments {
    escrow: RawTransactionArgument<string>;
}
export interface HandoverFloorMsOptions {
    package?: string;
    arguments: HandoverFloorMsArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function handoverFloorMs(options: HandoverFloorMsOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'handover_floor_ms',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface RetireCommitmentFloorMsArguments {
    escrow: RawTransactionArgument<string>;
}
export interface RetireCommitmentFloorMsOptions {
    package?: string;
    arguments: RetireCommitmentFloorMsArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function retireCommitmentFloorMs(options: RetireCommitmentFloorMsOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'retire_commitment_floor_ms',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface CreditShapeArguments {
    escrow: RawTransactionArgument<string>;
}
export interface CreditShapeOptions {
    package?: string;
    arguments: CreditShapeArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function creditShape(options: CreditShapeOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'credit_shape',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface AuctionShapeArguments {
    escrow: RawTransactionArgument<string>;
}
export interface AuctionShapeOptions {
    package?: string;
    arguments: AuctionShapeArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function auctionShape(options: AuctionShapeOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'auction_shape',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface PriceFnArguments {
    escrow: RawTransactionArgument<string>;
}
export interface PriceFnOptions {
    package?: string;
    arguments: PriceFnArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function priceFn(options: PriceFnOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'price_fn',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface TenureDurationIsFixedArguments {
    escrow: RawTransactionArgument<string>;
}
export interface TenureDurationIsFixedOptions {
    package?: string;
    arguments: TenureDurationIsFixedArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function tenureDurationIsFixed(options: TenureDurationIsFixedOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'tenure_duration_is_fixed',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface TenureCeilingFixedMsArguments {
    escrow: RawTransactionArgument<string>;
}
export interface TenureCeilingFixedMsOptions {
    package?: string;
    arguments: TenureCeilingFixedMsArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function tenureCeilingFixedMs(options: TenureCeilingFixedMsOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'tenure_ceiling_fixed_ms',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface RestPriceFloorFixedMistArguments {
    escrow: RawTransactionArgument<string>;
}
export interface RestPriceFloorFixedMistOptions {
    package?: string;
    arguments: RestPriceFloorFixedMistArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function restPriceFloorFixedMist(options: RestPriceFloorFixedMistOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'rest_price_floor_fixed_mist',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface CreditShapeIsLinearArguments {
    escrow: RawTransactionArgument<string>;
}
export interface CreditShapeIsLinearOptions {
    package?: string;
    arguments: CreditShapeIsLinearArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function creditShapeIsLinear(options: CreditShapeIsLinearOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'credit_shape_is_linear',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface CreditShapeIsSmoothstepArguments {
    escrow: RawTransactionArgument<string>;
}
export interface CreditShapeIsSmoothstepOptions {
    package?: string;
    arguments: CreditShapeIsSmoothstepArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function creditShapeIsSmoothstep(options: CreditShapeIsSmoothstepOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'credit_shape_is_smoothstep',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface CreditShapeIsLogisticArguments {
    escrow: RawTransactionArgument<string>;
}
export interface CreditShapeIsLogisticOptions {
    package?: string;
    arguments: CreditShapeIsLogisticArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function creditShapeIsLogistic(options: CreditShapeIsLogisticOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'credit_shape_is_logistic',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface CreditShapeIsPowerLawArguments {
    escrow: RawTransactionArgument<string>;
}
export interface CreditShapeIsPowerLawOptions {
    package?: string;
    arguments: CreditShapeIsPowerLawArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function creditShapeIsPowerLaw(options: CreditShapeIsPowerLawOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'credit_shape_is_power_law',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface CreditShapeIsExponentialArguments {
    escrow: RawTransactionArgument<string>;
}
export interface CreditShapeIsExponentialOptions {
    package?: string;
    arguments: CreditShapeIsExponentialArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function creditShapeIsExponential(options: CreditShapeIsExponentialOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'credit_shape_is_exponential',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface CreditShapePowerLawAlphaNumArguments {
    escrow: RawTransactionArgument<string>;
}
export interface CreditShapePowerLawAlphaNumOptions {
    package?: string;
    arguments: CreditShapePowerLawAlphaNumArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function creditShapePowerLawAlphaNum(options: CreditShapePowerLawAlphaNumOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'credit_shape_power_law_alpha_num',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface CreditShapePowerLawAlphaDenArguments {
    escrow: RawTransactionArgument<string>;
}
export interface CreditShapePowerLawAlphaDenOptions {
    package?: string;
    arguments: CreditShapePowerLawAlphaDenArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function creditShapePowerLawAlphaDen(options: CreditShapePowerLawAlphaDenOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'credit_shape_power_law_alpha_den',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface CreditShapeExponentialAlphaAbsArguments {
    escrow: RawTransactionArgument<string>;
}
export interface CreditShapeExponentialAlphaAbsOptions {
    package?: string;
    arguments: CreditShapeExponentialAlphaAbsArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function creditShapeExponentialAlphaAbs(options: CreditShapeExponentialAlphaAbsOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'credit_shape_exponential_alpha_abs',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface CreditShapeExponentialAlphaNegArguments {
    escrow: RawTransactionArgument<string>;
}
export interface CreditShapeExponentialAlphaNegOptions {
    package?: string;
    arguments: CreditShapeExponentialAlphaNegArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function creditShapeExponentialAlphaNeg(options: CreditShapeExponentialAlphaNegOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'credit_shape_exponential_alpha_neg',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface AuctionShapeIsLinearArguments {
    escrow: RawTransactionArgument<string>;
}
export interface AuctionShapeIsLinearOptions {
    package?: string;
    arguments: AuctionShapeIsLinearArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function auctionShapeIsLinear(options: AuctionShapeIsLinearOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'auction_shape_is_linear',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface AuctionShapeIsSmoothstepArguments {
    escrow: RawTransactionArgument<string>;
}
export interface AuctionShapeIsSmoothstepOptions {
    package?: string;
    arguments: AuctionShapeIsSmoothstepArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function auctionShapeIsSmoothstep(options: AuctionShapeIsSmoothstepOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'auction_shape_is_smoothstep',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface AuctionShapeIsLogisticArguments {
    escrow: RawTransactionArgument<string>;
}
export interface AuctionShapeIsLogisticOptions {
    package?: string;
    arguments: AuctionShapeIsLogisticArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function auctionShapeIsLogistic(options: AuctionShapeIsLogisticOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'auction_shape_is_logistic',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface AuctionShapeIsPowerLawArguments {
    escrow: RawTransactionArgument<string>;
}
export interface AuctionShapeIsPowerLawOptions {
    package?: string;
    arguments: AuctionShapeIsPowerLawArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function auctionShapeIsPowerLaw(options: AuctionShapeIsPowerLawOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'auction_shape_is_power_law',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface AuctionShapeIsExponentialArguments {
    escrow: RawTransactionArgument<string>;
}
export interface AuctionShapeIsExponentialOptions {
    package?: string;
    arguments: AuctionShapeIsExponentialArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function auctionShapeIsExponential(options: AuctionShapeIsExponentialOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'auction_shape_is_exponential',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface AuctionShapePowerLawAlphaNumArguments {
    escrow: RawTransactionArgument<string>;
}
export interface AuctionShapePowerLawAlphaNumOptions {
    package?: string;
    arguments: AuctionShapePowerLawAlphaNumArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function auctionShapePowerLawAlphaNum(options: AuctionShapePowerLawAlphaNumOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'auction_shape_power_law_alpha_num',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface AuctionShapePowerLawAlphaDenArguments {
    escrow: RawTransactionArgument<string>;
}
export interface AuctionShapePowerLawAlphaDenOptions {
    package?: string;
    arguments: AuctionShapePowerLawAlphaDenArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function auctionShapePowerLawAlphaDen(options: AuctionShapePowerLawAlphaDenOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'auction_shape_power_law_alpha_den',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface AuctionShapeExponentialAlphaAbsArguments {
    escrow: RawTransactionArgument<string>;
}
export interface AuctionShapeExponentialAlphaAbsOptions {
    package?: string;
    arguments: AuctionShapeExponentialAlphaAbsArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function auctionShapeExponentialAlphaAbs(options: AuctionShapeExponentialAlphaAbsOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'auction_shape_exponential_alpha_abs',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface AuctionShapeExponentialAlphaNegArguments {
    escrow: RawTransactionArgument<string>;
}
export interface AuctionShapeExponentialAlphaNegOptions {
    package?: string;
    arguments: AuctionShapeExponentialAlphaNegArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function auctionShapeExponentialAlphaNeg(options: AuctionShapeExponentialAlphaNegOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'auction_shape_exponential_alpha_neg',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface PriceFnIsFixedDeltaArguments {
    escrow: RawTransactionArgument<string>;
}
export interface PriceFnIsFixedDeltaOptions {
    package?: string;
    arguments: PriceFnIsFixedDeltaArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function priceFnIsFixedDelta(options: PriceFnIsFixedDeltaOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'price_fn_is_fixed_delta',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface PriceFnIsCompoundDeltaArguments {
    escrow: RawTransactionArgument<string>;
}
export interface PriceFnIsCompoundDeltaOptions {
    package?: string;
    arguments: PriceFnIsCompoundDeltaArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function priceFnIsCompoundDelta(options: PriceFnIsCompoundDeltaOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'price_fn_is_compound_delta',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface PriceFnFixedDeltaArguments {
    escrow: RawTransactionArgument<string>;
}
export interface PriceFnFixedDeltaOptions {
    package?: string;
    arguments: PriceFnFixedDeltaArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function priceFnFixedDelta(options: PriceFnFixedDeltaOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'price_fn_fixed_delta',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface PriceFnCompoundDeltaBpsArguments {
    escrow: RawTransactionArgument<string>;
}
export interface PriceFnCompoundDeltaBpsOptions {
    package?: string;
    arguments: PriceFnCompoundDeltaBpsArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function priceFnCompoundDeltaBps(options: PriceFnCompoundDeltaBpsOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'price_fn_compound_delta_bps',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface PriceFnCompoundDeltaDeltaArguments {
    escrow: RawTransactionArgument<string>;
}
export interface PriceFnCompoundDeltaDeltaOptions {
    package?: string;
    arguments: PriceFnCompoundDeltaDeltaArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function priceFnCompoundDeltaDelta(options: PriceFnCompoundDeltaDeltaOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'price_fn_compound_delta_delta',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface RestPriceKindArguments {
    escrow: RawTransactionArgument<string>;
}
export interface RestPriceKindOptions {
    package?: string;
    arguments: RestPriceKindArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function restPriceKind(options: RestPriceKindOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'rest_price_kind',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface TenureDurationKindArguments {
    escrow: RawTransactionArgument<string>;
}
export interface TenureDurationKindOptions {
    package?: string;
    arguments: TenureDurationKindArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function tenureDurationKind(options: TenureDurationKindOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'tenure_duration_kind',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface TenureExtendKindArguments {
    escrow: RawTransactionArgument<string>;
}
export interface TenureExtendKindOptions {
    package?: string;
    arguments: TenureExtendKindArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function tenureExtendKind(options: TenureExtendKindOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'tenure_extend_kind',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface HandoverKindArguments {
    escrow: RawTransactionArgument<string>;
}
export interface HandoverKindOptions {
    package?: string;
    arguments: HandoverKindArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function handoverKind(options: HandoverKindOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'handover_kind',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface AuctionWindowKindArguments {
    escrow: RawTransactionArgument<string>;
}
export interface AuctionWindowKindOptions {
    package?: string;
    arguments: AuctionWindowKindArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function auctionWindowKind(options: AuctionWindowKindOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'auction_window_kind',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface CreditShapeKindArguments {
    escrow: RawTransactionArgument<string>;
}
export interface CreditShapeKindOptions {
    package?: string;
    arguments: CreditShapeKindArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function creditShapeKind(options: CreditShapeKindOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'credit_shape_kind',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface AuctionShapeKindArguments {
    escrow: RawTransactionArgument<string>;
}
export interface AuctionShapeKindOptions {
    package?: string;
    arguments: AuctionShapeKindArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function auctionShapeKind(options: AuctionShapeKindOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'auction_shape_kind',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface PriceFnKindArguments {
    escrow: RawTransactionArgument<string>;
}
export interface PriceFnKindOptions {
    package?: string;
    arguments: PriceFnKindArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function priceFnKind(options: PriceFnKindOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'price_fn_kind',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface PriceFnDeltaMistArguments {
    escrow: RawTransactionArgument<string>;
}
export interface PriceFnDeltaMistOptions {
    package?: string;
    arguments: PriceFnDeltaMistArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function priceFnDeltaMist(options: PriceFnDeltaMistOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'price_fn_delta_mist',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface RetireCommitmentKindArguments {
    escrow: RawTransactionArgument<string>;
}
export interface RetireCommitmentKindOptions {
    package?: string;
    arguments: RetireCommitmentKindArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function retireCommitmentKind(options: RetireCommitmentKindOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'retire_commitment_kind',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface EnsembleCommitmentIsImmediateArguments {
    escrow: RawTransactionArgument<string>;
}
export interface EnsembleCommitmentIsImmediateOptions {
    package?: string;
    arguments: EnsembleCommitmentIsImmediateArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function ensembleCommitmentIsImmediate(options: EnsembleCommitmentIsImmediateOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'ensemble_commitment_is_immediate',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface EnsembleCommitmentIsDeferredArguments {
    escrow: RawTransactionArgument<string>;
}
export interface EnsembleCommitmentIsDeferredOptions {
    package?: string;
    arguments: EnsembleCommitmentIsDeferredArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function ensembleCommitmentIsDeferred(options: EnsembleCommitmentIsDeferredOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'ensemble_commitment_is_deferred',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface EnsembleCommitmentUnlocksAtMsArguments {
    escrow: RawTransactionArgument<string>;
}
export interface EnsembleCommitmentUnlocksAtMsOptions {
    package?: string;
    arguments: EnsembleCommitmentUnlocksAtMsArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function ensembleCommitmentUnlocksAtMs(options: EnsembleCommitmentUnlocksAtMsOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'ensemble_commitment_unlocks_at_ms',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface EnsembleCommitmentAnchorMsArguments {
    escrow: RawTransactionArgument<string>;
}
export interface EnsembleCommitmentAnchorMsOptions {
    package?: string;
    arguments: EnsembleCommitmentAnchorMsArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function ensembleCommitmentAnchorMs(options: EnsembleCommitmentAnchorMsOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'ensemble_commitment_anchor_ms',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface EnsembleCommitmentRemainingMsArguments {
    escrow: RawTransactionArgument<string>;
    nowMs: RawTransactionArgument<number | bigint>;
}
export interface EnsembleCommitmentRemainingMsOptions {
    package?: string;
    arguments: EnsembleCommitmentRemainingMsArguments | [
        escrow: RawTransactionArgument<string>,
        nowMs: RawTransactionArgument<number | bigint>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function ensembleCommitmentRemainingMs(options: EnsembleCommitmentRemainingMsOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null,
        'u64'
    ] satisfies (string | null)[];
    const parameterNames = ["escrow", "nowMs"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'ensemble_commitment_remaining_ms',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface EnsembleCommitmentFloorMsArguments {
    escrow: RawTransactionArgument<string>;
}
export interface EnsembleCommitmentFloorMsOptions {
    package?: string;
    arguments: EnsembleCommitmentFloorMsArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function ensembleCommitmentFloorMs(options: EnsembleCommitmentFloorMsOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'ensemble_commitment_floor_ms',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface EnsembleCommitmentKindArguments {
    escrow: RawTransactionArgument<string>;
}
export interface EnsembleCommitmentKindOptions {
    package?: string;
    arguments: EnsembleCommitmentKindArguments | [
        escrow: RawTransactionArgument<string>
    ];
    typeArguments: [
        string,
        string
    ];
}
export function ensembleCommitmentKind(options: EnsembleCommitmentKindOptions) {
    const packageAddress = options.package ?? '@local-pkg/usufruct';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'ensemble_commitment_kind',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}