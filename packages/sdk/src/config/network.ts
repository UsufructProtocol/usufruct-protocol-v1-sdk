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
  packageId: '0x49231e492e638892c80a301138d55e2275477d407b3b2b1092b0209081bb56cf',
  feeRefId: '0x1ea3c9af25419767ccd77e401970a455c7f7af188b5c1e8c73704a508d84fcaf',
};

/** System singletons (FFI artefacts — injected by the codegen layer). */
export const CLOCK_ID = '0x6';
export const RANDOM_ID = '0x8';

/** Testnet GraphQL endpoint (for `indexerSource`). */
export const GRAPHQL_TESTNET = 'https://graphql.testnet.sui.io/graphql';
