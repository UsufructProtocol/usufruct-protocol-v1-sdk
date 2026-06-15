/**
 * Coin sourcing for the high-level API (Layer 2).
 *
 * `payment` is a real `Coin<C>` argument of `rent` — never hidden (only the
 * `Clock` and `ProtocolFeeRef` singletons are). The developer either passes a
 * coin they control, or *opts in* to a `CoinSource` they write here. Resolved
 * against the signer's owned coins at PTB-build time.
 *
 * NOTE: implementation lands in Phase C; this is the shared type the factory
 * (`u.coin` / `u.fromBalance`) and `escrow.rent` agree on.
 */
import type { CoinTag } from './value.js';

/**
 * An explicit, opt-in instruction for where a payment coin comes from.
 * - `{ kind: 'exact' }` — split exactly `amountMist` from the signer's `Coin<C>`.
 * - `{ kind: 'minimum' }` — let the call split exactly what it needs (`floor×count`).
 */
export type CoinSource =
  | { readonly kind: 'exact'; readonly coin: CoinTag; readonly amountMist: bigint }
  | { readonly kind: 'minimum'; readonly coin: CoinTag };
