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

/** usufruct v1.4.3 on Sui testnet (source-verified, immutable). */
export const TESTNET: PackageIds = {
  packageId: '0xf5f039b85aad208f77ed5eec05df51dc889154a0491709c5a9cb4ecb17a62567',
  feeRefId: '0xa9f5a89e419b52bba0db972ff896c36cf7e8464fc71addb7d1256b27c30fb17d',
};

/** System singletons (FFI artefacts — injected by the codegen layer). */
export const CLOCK_ID = '0x6';
export const RANDOM_ID = '0x8';

/** Testnet GraphQL endpoint (for `indexerSource`). */
export const GRAPHQL_TESTNET = 'https://graphql.testnet.sui.io/graphql';
