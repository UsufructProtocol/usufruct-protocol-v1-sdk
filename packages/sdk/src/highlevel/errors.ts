/**
 * Typed errors (Layer 2). SPEC rule #4: a failed action surfaces a typed error,
 * never a swallowed `null`.
 *
 * On-chain aborts are resolved through `MOVE_ABORTS` — the registry generated from
 * the Move source (`scripts/gen-aborts.ts`) — so `mapAbort` knows *every* runtime
 * abort by its exact source name (`EAlreadyRetired`, `ENotRented`, …), keyed on
 * (module, code). The curated subclasses below are a friendly overlay over the
 * common ones (so `instanceof InsufficientPayment` keeps working); anything else
 * surfaces as a `MoveAbortError` carrying the source name. Non-abort errors
 * (off-chain checks, missing signer) rethrow unchanged.
 */
import { MOVE_ABORTS, type MoveAbortEntry } from './aborts.generated.js';

export class UsufructError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

// ── off-chain / guard errors (not aborts) ──
/** The signer can't cover the payment from its owned coins (off-chain check). */
export class InsufficientBalance extends UsufructError {}
/** A write that needs a signer was attempted on a read-only handle. */
export class NotConnected extends UsufructError {}

/**
 * A Move abort surfaced from a write, carrying the **source nomenclature**: the
 * module, the per-module code, and the verbatim Move constant (`abort`). The
 * message leads with the constant and pins `(module #code)`. `Error.name` stays
 * the class name; the Move constant is the separate `abort` field.
 */
export class MoveAbortError extends UsufructError {
  readonly module: string;
  readonly code: number;
  /** The Move constant, verbatim (e.g. `EAlreadyRetired`). */
  readonly abort: string;
  constructor(entry: MoveAbortEntry) {
    super(`${entry.name} — ${messageFor(entry.name)}  (${entry.module} #${entry.code})`);
    this.module = entry.module;
    this.code = entry.code;
    this.abort = entry.name;
  }
}

// ── curated overlay: common aborts get a friendly class (all extend MoveAbortError,
//    so they carry module/code/abort too). Markers only — no extra behavior. ──
/** `EInsufficientPayment` — payment was below `floor × tenures`. */
export class InsufficientPayment extends MoveAbortError {}
/** The escrow can't be rented now (retiring / retired). */
export class NotAvailable extends MoveAbortError {}
/** `retire` before the retire-commitment window elapses. */
export class CommittedRetire extends MoveAbortError {}
/** `updateMarket` before the ensemble-commitment window elapses. */
export class CommittedEnsemble extends MoveAbortError {}
/** A governance write whose `GovernanceCap` doesn't govern this escrow. */
export class NotGovernor extends MoveAbortError {}
/** Invalid `escalation` — the delta must be > 0 (and bps in range). */
export class InvalidEscalation extends MoveAbortError {}
/** Invalid curve `Shape` — e.g. powerLaw `num === den` (that's just `linear`). */
export class InvalidShape extends MoveAbortError {}
/** An invalid market value a policy rejects — a zero duration/price, or handover > tenure. */
export class InvalidMarket extends MoveAbortError {}

/** Move constant name → friendly subclass (the rest fall back to `MoveAbortError`). */
const OVERLAY: Readonly<Record<string, new (e: MoveAbortEntry) => MoveAbortError>> = {
  EInsufficientPayment: InsufficientPayment,
  ERetireFlagBlocksBid: NotAvailable,
  ERetiredNoBid: NotAvailable,
  ERetireCommitmentFloorNotElapsed: CommittedRetire,
  EEnsembleCommitmentFloorNotElapsed: CommittedEnsemble,
  EWrongEscrowGovernanceCap: NotGovernor,
  EDeltaZero: InvalidEscalation,
  EBpsRange: InvalidEscalation,
  EAlphaNumRange: InvalidShape,
  EAlphaDenRange: InvalidShape,
  EDegenerateLinear: InvalidShape,
  EAlphaAbsRange: InvalidShape,
  EPriceZero: InvalidMarket,
  EDurationZero: InvalidMarket,
  EDescentCeilingZero: InvalidMarket,
  EHandoverFloorZero: InvalidMarket,
  ERetireCommitmentFloorZero: InvalidMarket,
  EEnsembleCommitmentFloorZero: InvalidMarket,
  EHandoverFloorExceedsTenure: InvalidMarket,
};

/** Nicer text for common aborts; the rest are humanized from the constant name. */
const MESSAGES: Readonly<Record<string, string>> = {
  ENotRented: 'the escrow is not currently rented',
  EInsufficientPayment: 'the payment was below floor × tenures',
  EAlreadyRetired: 'the asset is already retired',
  EAlreadyRetiring: 'the escrow is already retiring',
  ENotRetired: 'the asset is not retired yet',
  EPendingUsufructCap: 'a challenger is pending — this cap is not the active seat',
  EStaleUsufructCap: 'this usufruct cap is stale (the holder was displaced)',
  EUsufructCapNotStale: 'this usufruct cap is still active/pending — not stale',
  EWrongEscrowUsufructCap: 'this usufruct cap belongs to a different escrow',
  EWrongEscrowGovernanceCap: 'this governance cap does not govern this escrow',
  EReceiptEscrowMismatch: 'the borrow receipt is for a different escrow',
  EReturnedDifferentAsset: 'a different asset was returned than was borrowed',
};

/** `EAlreadyRetired` → "already retired". */
function humanize(name: string): string {
  return name
    .replace(/^E/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .trim();
}
function messageFor(name: string): string {
  return MESSAGES[name] ?? humanize(name);
}

/** (module, code) → entry — the abort's identity (codes are per-module). */
const LOOKUP = new Map<string, MoveAbortEntry>(MOVE_ABORTS.map((a) => [`${a.module}:${a.code}`, a]));

// Runtime aborts read as e.g. `... abort code: 18, in '0x…::asset_state::…'`.
const ABORT_RE = /abort code:\s*(\d+),?\s*in\s*'0x\w+::(\w+)::/;

/** Extract `(module, code)` from a caught error, or `null` if it isn't a Move abort. */
function parseAbort(e: unknown): { module: string; code: number } | null {
  const msg = String((e as { message?: unknown } | null)?.message ?? e);
  const m = ABORT_RE.exec(msg);
  return m ? { module: m[2]!, code: Number(m[1]) } : null;
}

/**
 * Rethrow a caught error as a typed `UsufructError` when it is a known Move abort:
 * the friendly subclass if one is mapped, else a `MoveAbortError` naming the
 * constant. Unknown aborts and non-abort errors rethrow unchanged.
 */
export function mapAbort(e: unknown): never {
  const parsed = parseAbort(e);
  if (parsed) {
    const entry = LOOKUP.get(`${parsed.module}:${parsed.code}`);
    if (entry) {
      const Ctor = OVERLAY[entry.name] ?? MoveAbortError;
      throw new Ctor(entry);
    }
  }
  throw e;
}
