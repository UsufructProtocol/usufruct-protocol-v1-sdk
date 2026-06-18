/**
 * ❸ Action (SPEC §4.3) — a value with two interpretations of one semantic
 * operation: `step` (off-chain pure) and `toPtb` (on-chain PTB). The three
 * variants encode lifecycle constraints in the type system: nothing can be
 * chained after a `TerminalAction` because it returns no successor state.
 */
import type { Transaction, TransactionResult } from '@mysten/sui/transactions';
import type { Ms } from './brand.js';

/**
 * `step` is an unconditionally deterministic function of `(state, t)`. The
 * protocol carries no stochastic policy — every transition is fixed-point
 * integer math over the state and the clock (SPEC §8). There is no `Rng`.
 *
 * The lifecycle variants are generic over the state aggregate `S` they govern
 * (SPEC §4.3) — there is NO default. The escrow mirror passes `EscrowState`
 * (which lives in `@usufruct-protocol/sim`, with the `step` interpretations);
 * inbox actions pass `MessageGroups`. The core never names `EscrowState`, so it
 * cannot depend on the mirror — the dependency arrow stays sim → sdk.
 */

/**
 * The core (drift-zero) interpretation of an action: **a PTB builder, and
 * nothing else** — so it is literally a function `(tx, args) => TransactionResult`,
 * not an object. A core "action" IS its `toPtb`. The second interpretation,
 * `step` (an off-chain re-derivation of the contract's effect), is a mirror
 * concern: the opt-in `sim` layer composes a full `Origin/Transition/Terminal`
 * action (below) by pairing a `step` with one of these builders. Confining the
 * core's action surface to the builder function is what makes it impossible to
 * drift. `R` defaults to a single `TransactionResult`; `collect` uses `[]`.
 */
export type PtbAction<P, R = TransactionResult> = (tx: Transaction, args: P) => R;

/** Creates a state aggregate (only `integrate` for escrows). */
export interface OriginAction<R, P, S> {
  readonly step: (t: Ms) => { state: S; result: R };
  readonly toPtb: PtbAction<P>;
}

/** Mutates a state aggregate. */
export interface TransitionAction<R, P, S> {
  readonly step: (state: S, t: Ms) => { state: S; result: R };
  readonly toPtb: PtbAction<P>;
}

/** Consumes a state aggregate — no successor state. */
export interface TerminalAction<R, P, S> {
  readonly step: (state: S, t: Ms) => { result: R };
  readonly toPtb: PtbAction<P>;
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
