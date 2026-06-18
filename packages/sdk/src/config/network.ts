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

/** usufruct on Sui testnet (source-verified, immutable) — the deploy that adds the
 *  next_boundary_ms / descent_expiry_ms views. */
export const TESTNET: PackageIds = {
  packageId: '0xec8588cfbce2fef4341feeff218a1e324f12ae45a0c19e9d0d338a9c3b0802b3',
  feeRefId: '0x1d15c4dc987d638b0da1200857a9911f9f74c028fdc8967e0e8be94b41dd2aea',
};

/** System singletons (FFI artefacts — injected by the codegen layer). */
export const CLOCK_ID = '0x6';
export const RANDOM_ID = '0x8';

/** Testnet GraphQL endpoint (for `indexerSource`). */
export const GRAPHQL_TESTNET = 'https://graphql.testnet.sui.io/graphql';
