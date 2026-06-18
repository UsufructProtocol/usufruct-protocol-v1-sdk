/**
 * Tier 2 (opt-in): the functional mirror (SPEC §2.1, §6.2).
 *
 * `EscrowState` decoded once, then pure `View` / `Action.step` evaluated
 * locally at any `(state, t)` — for simulation, an off-chain testbed, or an
 * agenda over many escrows without per-view round-trips. This tier
 * re-derives the protocol's logic and is golden-tested against the on-chain
 * views (the `read` tier, its oracle). When a mirror lacks coverage, read
 * through `read` instead.
 *
 * This is a re-export facade — the mirror modules are unchanged.
 */
export * as curve from './curve.js';
export * as actions from './actions/index.js';
export * from '../views/index.js';
// The raw snapshot model + asset schema config come from the core; the decoded
// model (`EscrowState`/`EscrowData`) and its decoder are the mirror's own.
export * from '@usufruct-protocol/sdk/primitives/state.js';
export * from '../primitives/state.js';
export * from '../primitives/view.js';
export * from '@usufruct-protocol/sdk/primitives/source.js';
export { grpcSource } from '@usufruct-protocol/sdk/primitives/grpc-source.js';
export type { GrpcSource, EscrowUpdate, ManySubscription } from '@usufruct-protocol/sdk/primitives/grpc-source.js';
export { memorySource } from '../primitives/memory-source.js';
export type { MemorySource } from '../primitives/memory-source.js';
export { memoryInbox, postSettlement } from '../primitives/memory-inbox.js';
export type { MemoryInbox } from '../primitives/memory-inbox.js';
export type {
  OriginAction,
  TransitionAction,
  TerminalAction,
} from '@usufruct-protocol/sdk/primitives/action.js';
export { NotImplementedStepError } from '@usufruct-protocol/sdk/primitives/action.js';
