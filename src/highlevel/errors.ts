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

/** `update` before the ensemble commitment window elapses. */
export class CommittedEnsemble extends UsufructError {}

/** `retire` before the retire commitment window elapses. */
export class CommittedRetire extends UsufructError {}

/** A governance write attempted without holding the escrow's GovernanceCap. */
export class NotGovernor extends UsufructError {}

/**
 * Move abort → typed error, keyed by (module, code). Runtime aborts carry the
 * numeric code + the module where they fired (e.g. `abort code: 18, in
 * '0x…::asset_state::…'`) — NOT the Move constant name — so we match those.
 * Codes are from `engine/asset_state.move` (verified live).
 */
const ABORTS: ReadonlyArray<{
  readonly module: string;
  readonly code: number;
  readonly Ctor: new (m: string) => UsufructError;
}> = [
  { module: 'asset_state', code: 1, Ctor: InsufficientPayment }, // EInsufficientPayment
  { module: 'asset_state', code: 18, Ctor: CommittedEnsemble }, // EEnsembleCommitmentFloorNotElapsed
  { module: 'asset_state', code: 4, Ctor: CommittedRetire }, // ERetireCommitmentFloorNotElapsed
  { module: 'asset_state', code: 2, Ctor: NotAvailable }, // ERetireFlagBlocksBid
  { module: 'asset_state', code: 3, Ctor: NotAvailable }, // ERetiredNoBid
];

const ABORT_RE = /abort code: (\d+),?\s*in '0x\w+::(\w+)::/;

/** Rethrow a caught error as a typed `UsufructError` when its message is a known abort. */
export function mapAbort(e: unknown): never {
  const msg = String((e as { message?: unknown })?.message ?? e);
  const m = ABORT_RE.exec(msg);
  if (m) {
    const code = Number(m[1]);
    const mod = m[2];
    for (const a of ABORTS) {
      if (a.module === mod && a.code === code) throw new a.Ctor(msg);
    }
  }
  throw e;
}
