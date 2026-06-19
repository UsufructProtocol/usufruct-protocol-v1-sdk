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
 *  parameterized curve views (descent_floor_at / used_credit_at / ascending_floor_with)
 *  and the per-cycle shape/escalation policies in CycleParamsResolved. */
export const TESTNET: PackageIds = {
  packageId: '0x4e00103fc85bdf54876a1d14e1957fef5e18def81dab3917d249b06c5d2e6ebf',
  feeRefId: '0x6a00b57cd75d0bf86984faf84c7a514353e0a1dbee26a75eaf66b128c829bd3b',
};

/** System singletons (FFI artefacts — injected by the codegen layer). */
export const CLOCK_ID = '0x6';
export const RANDOM_ID = '0x8';

/** Testnet GraphQL endpoint (for `indexerSource`). */
export const GRAPHQL_TESTNET = 'https://graphql.testnet.sui.io/graphql';
