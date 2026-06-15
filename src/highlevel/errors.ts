/**
 * Typed errors (Layer 2). SPEC rule #4: a failed action surfaces a typed
 * error, never a swallowed `null`. `mapAbort` translates the known Move abort
 * codes into this hierarchy; anything else is rethrown unchanged.
 */
export class UsufructError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** The signer can't cover the payment from its owned coins (off-chain check). */
export class InsufficientBalance extends UsufructError {}

/** `EInsufficientPayment` — payment was below `floor × tenures`. */
export class InsufficientPayment extends UsufructError {}

/** The escrow can't be rented now (e.g. retired). */
export class NotAvailable extends UsufructError {}

/** A write that needs a signer was attempted on a read-only handle. */
export class NotConnected extends UsufructError {}

const ABORTS: ReadonlyArray<readonly [string, new (m: string) => UsufructError]> = [
  ['EInsufficientPayment', InsufficientPayment],
  ['ERetiredNoBid', NotAvailable],
  ['ERetireFlagBlocksBid', NotAvailable],
];

/** Rethrow a caught error as a typed `UsufructError` when its message names a known abort. */
export function mapAbort(e: unknown): never {
  const msg = String((e as { message?: unknown })?.message ?? e);
  for (const [code, Ctor] of ABORTS) {
    if (msg.includes(code)) throw new Ctor(msg);
  }
  throw e;
}
