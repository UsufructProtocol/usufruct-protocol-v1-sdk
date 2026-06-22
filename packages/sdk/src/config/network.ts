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

/** usufruct on Sui testnet (source-verified, immutable) — the parameterized curve views
 *  (descent_floor_at / used_credit_at / ascending_floor_with), with the curve shapes read
 *  from the ensemble events (CycleParamsResolved carries only the resolved scalars). */
export const TESTNET: PackageIds = {
  packageId: '0x1045b0984ff9eab840abfd8a02f7c938a99334da7668e24e16737deb9979f2ee',
  feeRefId: '0xf910aed3b021373d1e8bc7a77d46c97a6e8c836645bc248084443514d85318e6',
};

/** System singletons (FFI artefacts — injected by the codegen layer). */
export const CLOCK_ID = '0x6';
export const RANDOM_ID = '0x8';

/** Testnet GraphQL endpoint (for `indexerSource`). */
export const GRAPHQL_TESTNET = 'https://graphql.testnet.sui.io/graphql';
