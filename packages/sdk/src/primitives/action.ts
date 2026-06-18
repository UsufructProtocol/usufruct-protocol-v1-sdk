/**
 * ❸ Action (SPEC §4.3) — the core (drift-zero) interpretation of an action:
 * **a PTB builder, and nothing else** — so it is literally a function
 * `(tx, args) => TransactionResult`, not an object. A core "action" IS its
 * `toPtb`.
 *
 * The second interpretation, `step` (an off-chain re-derivation of the
 * contract's effect), is a mirror concern: the opt-in `sim` layer
 * (`@usufruct-protocol/sim`) composes a full `Origin/Transition/Terminal`
 * action by pairing a `step` with one of these builders. Confining the core's
 * action surface to the builder function is what makes it impossible to drift,
 * and it keeps the dependency arrow one-way (sim → sdk): the core never names
 * `EscrowState` or any `step`.
 */
import type { Transaction, TransactionResult } from '@mysten/sui/transactions';

/**
 * `R` defaults to a single `TransactionResult`; `collect` uses `[]`.
 */
export type PtbAction<P, R = TransactionResult> = (tx: Transaction, args: P) => R;
