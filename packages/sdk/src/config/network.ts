/**
 * Deployment coordinates. Actions never hardcode ids — they receive a
 * `PackageIds` (threaded from here or from the integrator's own config).
 */

export interface PackageIds {
  /** The deployed `usufruct` package id. */
  readonly packageId: string;
  /** Shared `ProtocolFeeRef` object consumed by `integrate`. */
  readonly feeRefId: string;
}

/** usufruct v1.4.2 on Sui testnet (source-verified, immutable). */
export const TESTNET: PackageIds = {
  packageId: '0x415c4372bb9db5affe2ab2bf6d72a6a667ed3178a61d6201e9ff26dc76380e5d',
  feeRefId: '0x41a7dee6e39f950fa2f7179464e400bb20cd6e620b5fcdbadf1db1b57ec87145',
};

/** System singletons (FFI artefacts — injected by the codegen layer). */
export const CLOCK_ID = '0x6';
export const RANDOM_ID = '0x8';

/** Testnet GraphQL endpoint (for `indexerSource`). */
export const GRAPHQL_TESTNET = 'https://graphql.testnet.sui.io/graphql';
