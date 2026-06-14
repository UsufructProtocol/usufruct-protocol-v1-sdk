/**
 * Event typing for the indexer (SPEC §6.3). The protocol emits ~30 events;
 * ~25 carry `escrow_id` — the de-facto primary key of the star schema. The
 * GraphQL `EventFilter` cannot filter by a payload field, so per-escrow history
 * is assembled client-side; this module supplies the typing for that.
 *
 * The payload is the indexer's **`contents.json`**, decoded against the
 * deployed package's ABI. (We do *not* BCS-decode `eventBcs` with the codegen
 * structs: the codegen is generated from a local Move source whose event field
 * order skews from the deployed v1.4.2 layout, so a codegen `.parse` of the
 * on-chain bytes silently mis-reads `escrow_id` — confirmed live. The indexer's
 * json is the ABI-correct source.)
 */

/** A typed event: the indexer-parsed payload plus metadata. */
export interface TypedEvent<T = Record<string, unknown>> {
  /** Fully-qualified `pkg::module::Name`. */
  readonly type: string;
  readonly module: string;
  readonly name: string;
  readonly sender: string | null;
  /** ISO-8601 emission time (sorts chronologically as a string). */
  readonly timestamp: string | null;
  /** The escrow this event belongs to, if its payload carries one. */
  readonly escrowId: string | null;
  /** The decoded payload (indexer json). */
  readonly data: T;
  /** The raw indexer payload (same content as `data`; kept for compatibility). */
  readonly json: Record<string, unknown>;
}

/**
 * The event names (`module::Name`) keyed by `escrow_id` — an escrow's timeline
 * is exactly these. The `*Collected` messages key on the inbox and
 * `GovernanceCapBurned` on the cap, so they are excluded. Used as
 * `escrowTimeline`'s default fan-out.
 */
export const ESCROW_KEYED: readonly string[] = [
  'asset_state::RentStarted',
  'asset_state::AuctionExpired',
  'asset_state::CycleParamsResolved',
  'asset_state::AssetRetired',
  'asset_state::RetireCommitmentExtended',
  'asset_state::EnsembleCommitmentExtended',
  'asset_state::AssetIntegrated',
  'asset_state::AssetClaimed',
  'asset_state::BidPlaced',
  'asset_state::BidSuperseded',
  'asset_state::HandoverCompleted',
  'asset_state::TenureExpired',
  'asset_state::RetireFlagSet',
  'asset_state::AssetBorrowed',
  'asset_state::AssetReturned',
  'asset_state::ActiveUsufructuaryRefundAddressUpdated',
  'asset_state::PendingUsufructuaryRefundAddressUpdated',
  'earnings_message::EarningsMessagePosted',
  'fee_message::FeeMessagePosted',
  'governance_cap::GovernanceCapMinted',
  'usufruct_cap::UsufructCapMinted',
  'usufruct_cap::UsufructCapBurned',
  'policy_ensemble::PolicyEnsembleRegistered',
  'policy_ensemble::EnsembleUpdated',
  'policy_ensemble::EnsembleUpdateScheduled',
];

/** `module::Name` of a fully-qualified `pkg::module::Name`. */
export function eventKey(type: string): string {
  return type.split('::').slice(-2).join('::');
}

/** `0x`-prefixed, zero-padded 64-hex form for comparing escrow ids. */
export function normEscrowId(s: string): string {
  return '0x' + s.replace(/^0x/, '').toLowerCase().padStart(64, '0');
}

/** The `escrow_id` of a decoded payload (normalized), or `null`. */
export function escrowIdOf(data: Record<string, unknown> | null | undefined): string | null {
  const e = data?.['escrow_id'];
  return typeof e === 'string' ? normEscrowId(e) : null;
}

/** Assemble a `TypedEvent` from an indexer node's fields. */
export function toTypedEvent(node: {
  type: string;
  sender: string | null;
  timestamp: string | null;
  json: Record<string, unknown>;
}): TypedEvent {
  const key = eventKey(node.type);
  return {
    type: node.type,
    module: key.split('::')[0]!,
    name: key.split('::')[1] ?? key,
    sender: node.sender,
    timestamp: node.timestamp,
    escrowId: escrowIdOf(node.json),
    data: node.json,
    json: node.json,
  };
}
