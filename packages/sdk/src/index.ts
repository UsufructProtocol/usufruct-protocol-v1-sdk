// Tier 1 (default): thin wrapper over the on-chain views — drift-free reads.
export { createReader } from './read/reader.js';
export type { Reader, ReaderTarget, SnapshotOpts } from './read/reader.js';
export * as read from './read/index.js';

// Write path: the `PtbAction` builders (each a `(tx, args) => TransactionResult`).
export * as actions from './actions/index.js';


// Non-core convenience: GraphQL discovery (by governor / type / all) + events.
export * as indexer from './indexer/index.js';

// Shared value types and config, used across all tiers.
export * from './primitives/brand.js';
export * from './config/ensemble.js';
export * from './config/network.js';

// Layer 2: the high-level, developer-facing API (the default entry point).
export * from './highlevel/index.js';
