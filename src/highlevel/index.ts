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

export { duration, toEnsembleConfig } from './market.js';
export type { Market, Duration, Shape, Commitment, PowerLawNum, PowerLawDen, ExpAlpha } from './market.js';

export type { Escrow, EscrowStatus } from './escrow.js';
export type { UsufructCap, RentReceipt, BorrowReceipt, BorrowMethod, Use } from './cap.js';
export type { GovernanceCap, EscrowRef } from './governanceCap.js';
export type { Inbox, EarningsInbox, ProtocolFeeInbox } from './inbox.js';

export {
  UsufructError,
  InsufficientBalance,
  InsufficientPayment,
  NotAvailable,
  NotConnected,
  CommittedEnsemble,
  CommittedRetire,
  NotGovernor,
  InvalidEscalation,
  InvalidShape,
  InvalidMarket,
} from './errors.js';
