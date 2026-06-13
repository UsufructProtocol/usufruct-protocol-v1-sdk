// Tier 1 (default): thin wrapper over the on-chain views — drift-free reads.
export { createReader } from './read/reader.js';
export type { Reader, ReaderTarget, SnapshotOpts } from './read/reader.js';
export * as read from './read/index.js';

// Write path: Action.toPtb builds the PTBs.
export * as actions from './actions/index.js';

// Tier 2 (opt-in): the functional mirror for local computation.
export * as sim from './sim/index.js';

// Shared value types and config, used across all tiers.
export * from './primitives/brand.js';
export * from './config/ensemble.js';
export * from './config/network.js';
