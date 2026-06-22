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
  RootNavVerb,
  RootReadVerb,
  RootInspectVerb,
  RootReactVerb,
  RootWriteVerb,
} from './usufruct.js';

export { SUI, price, coinTag, coinInfo } from './value.js';
export type { Price, CoinInfo, CoinTag } from './value.js';

export { duration, toEnsembleConfig } from './market.js';
export type { Market, Duration, Shape, Commitment, PowerLawNum, PowerLawDen, ExpAlpha } from './market.js';

export type {
  Escrow,
  EscrowStatus,
  TenureSettlement,
  HandoverSettlement,
  CyclePreview,
  AssetState,
  EscrowSnapshot,
  EscrowNavVerb,
  EscrowReadVerb,
  EscrowInspectVerb,
  EscrowReactVerb,
  EscrowWriteVerb,
} from './escrow.js';
export type { ScalarReadVerb } from './escrowRead.js';
export type {
  UsufructCap,
  UsufructCapState,
  UsufructCapRole,
  RentReceipt,
  BorrowReceipt,
  BorrowMethod,
  Use,
  CapNavVerb,
  CapReadVerb,
  CapInspectVerb,
  CapReactVerb,
  CapWriteVerb,
} from './cap.js';
// Deferred writes: a write is build → execute → decode; `Executor` swaps signing.
export { signerExecutor, walletExecutor, executeSigned } from './send.js';
export type { Executor, ExecResult, WalletSigner } from './send.js';
export type { Plan } from './plan.js';
export type {
  GovernanceCap,
  EscrowRef,
  GovernanceReadVerb,
  GovernanceInspectVerb,
  GovernanceReactVerb,
  GovernanceWriteVerb,
} from './governanceCap.js';
export type {
  Inbox,
  EarningsInbox,
  ProtocolFeeInbox,
  InboxMessage,
  InboxTotal,
  InboxReadVerb,
  InboxInspectVerb,
  InboxReactVerb,
  InboxWriteVerb,
} from './inbox.js';
export type { EscrowListing, UsufructCapRecord } from './listings.js';
export type { HistoryEvent } from './history.js';
export type {
  CurvePoint,
  CreditSegment,
  DescentSegment,
  PriceMarker,
  TimelineSegment,
  CurveOpts,
  LadderRung,
} from './timeline.js';
export type { PortfolioWatch } from './watch-many.js';
export type { RenterStatement, RenterStatus, Tenancy, EscrowRevenue } from './ledger.js';

export {
  withRetry,
  retryingClient,
  retryingReader,
  retryingGraphqlClient,
  isTransientStatus,
  isTransientNetwork,
  isTransientRequest,
  isTruncatedRead,
  isTransientRead,
} from './retry.js';
export type { RetryOptions } from './retry.js';

export {
  UsufructError,
  MoveAbortError,
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
export { MOVE_ABORTS, type MoveAbortEntry } from './aborts.generated.js';
