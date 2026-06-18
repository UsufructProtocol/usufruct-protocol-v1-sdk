/**
 * ❸ Action — the mirror's lifecycle variants (SPEC §4.3).
 *
 * The core (`@usufruct-protocol/sdk`) ships only `PtbAction` — a bare PTB
 * builder `(tx, args) => R`. The opt-in `sim` mirror composes a FULL action by
 * pairing a `step` (the off-chain, deterministic re-derivation of the
 * contract's effect) with one of those builders. The three variants encode
 * lifecycle constraints in the type system: nothing can be chained after a
 * `TerminalAction` because it returns no successor state.
 *
 * `step` is an unconditionally deterministic function of `(state, t)`. The
 * protocol carries no stochastic policy — every transition is fixed-point
 * integer math over the state and the clock (SPEC §8). There is no `Rng`.
 *
 * The variants are generic over the state aggregate `S` they govern — there is
 * NO default. Escrow actions pass `EscrowState`; inbox actions pass
 * `MessageGroups`.
 */
import type { PtbAction } from '@usufruct-protocol/sdk/primitives/action.js';
import type { Ms } from '@usufruct-protocol/sdk/primitives/brand.js';

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
