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
export * from '../views/index.js';
export * from '../primitives/state.js';
export * from '../primitives/view.js';
export * from '../primitives/source.js';
export type {
  OriginAction,
  TransitionAction,
  TerminalAction,
} from '../primitives/action.js';
export { NotImplementedStepError } from '../primitives/action.js';
