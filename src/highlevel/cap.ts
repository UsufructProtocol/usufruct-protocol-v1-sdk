/**
 * The `UsufructCap` handle (Layer 2) — the right of use, and the keystone
 * `borrow`/`return` bracket.
 *
 * NOTE: full surface (`borrow`, `borrow.into`, `receipt`, `escrow()` back-edge)
 * lands in Phase D. This is the minimal shape the factory and `rent` return.
 */

/** Mint details when the cap came from a `rent()` call. */
export interface RentReceipt {
  /** What was paid (≥ floor × tenures; surplus becomes stake). */
  readonly paid: import('./value.js').Price;
  /** When the current tenancy boundary falls. */
  readonly expiresAt: Date;
  /** The rent transaction digest. */
  readonly digest: string;
}

/** The right of use. The cap is the receiver of its writes — never a hidden arg. */
export interface UsufructCap {
  readonly id: string;
  readonly escrowId: string;
  /** Mint details if this handle came from `rent()`, else `null`. */
  readonly receipt: RentReceipt | null;
}
