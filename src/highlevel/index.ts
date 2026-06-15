/**
 * Layer 2 — the high-level, developer-facing API, composed entirely from the
 * four kernel primitives (SPEC rule #1). `usufruct()` is the entry point; the
 * kernel stays reachable via `u.primitives` and the package's named exports.
 */
export { usufruct } from './usufruct.js';
export type {
  Usufruct,
  UsufructConfig,
  Network,
  When,
  Primitives,
} from './usufruct.js';

export { SUI, price, coinTag, coinInfo } from './value.js';
export type { Price, CoinInfo, CoinTag } from './value.js';

export type { Escrow, EscrowStatus } from './escrow.js';
export type { UsufructCap, RentReceipt } from './cap.js';
export type { CoinSource, Payment } from './coins.js';

export {
  UsufructError,
  InsufficientBalance,
  InsufficientPayment,
  NotAvailable,
  NotConnected,
} from './errors.js';
