/**
 * ❸ Action (SPEC §4.3) — a value with two interpretations of one semantic
 * operation: `step` (off-chain pure) and `toPtb` (on-chain PTB). The three
 * variants encode lifecycle constraints in the type system: nothing can be
 * chained after a `TerminalAction` because it returns no successor state.
 */
import type { Transaction, TransactionResult } from '@mysten/sui/transactions';
import type { Ms } from './brand.js';
import type { EscrowState } from './state.js';

/**
 * `step` is an unconditionally deterministic function of `(state, t)`. The
 * protocol carries no stochastic policy — every transition is fixed-point
 * integer math over the state and the clock (SPEC §8). There is no `Rng`.
 *
 * The lifecycle variants are generic over the state aggregate they govern
 * (SPEC §4.3). `EscrowState` is the default — the aggregate of all escrow
 * actions. Inbox actions transition over `MessageGroups`. The kernel gains
 * no primitive: only genericity.
 */

/** Creates a state aggregate (only `integrate` for escrows). */
export interface OriginAction<R, P, S = EscrowState> {
  readonly step: (t: Ms) => { state: S; result: R };
  readonly toPtb: (tx: Transaction, args: P) => TransactionResult;
}

/** Mutates a state aggregate. */
export interface TransitionAction<R, P, S = EscrowState> {
  readonly step: (state: S, t: Ms) => { state: S; result: R };
  readonly toPtb: (tx: Transaction, args: P) => TransactionResult;
}

/** Consumes a state aggregate — no successor state. */
export interface TerminalAction<R, P, S = EscrowState> {
  readonly step: (state: S, t: Ms) => { result: R };
  readonly toPtb: (tx: Transaction, args: P) => TransactionResult;
}

/**
 * Thrown by `step` interpretations that do not ship yet: SPEC §8.2 forbids a
 * `step` without cross-runtime golden coverage. `toPtb` remains available.
 */
export class NotImplementedStepError extends Error {
  constructor(action: string) {
    super(
      `${action}.step has no golden-test coverage yet (SPEC §8.2); ` +
        `use toPtb (live) or a Pattern A read instead.`,
    );
    this.name = 'NotImplementedStepError';
  }
}
