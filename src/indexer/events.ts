/**
/**
 * Event typing for the indexer (SPEC §6.3). The protocol emits ~30 events;
 * ~25 carry `escrow_id` — the de-facto primary key of the star schema. The
 * GraphQL `EventFilter` cannot filter by a payload field, so per-escrow history
 * is assembled client-side; this module supplies the typing for that.
 *
 * The payload is BCS-decoded from the GraphQL `contents.bcs` (the MoveValue's
 * *pure* struct bytes) with the codegen structs — bit-exact, the same decode
 * the transaction-level path uses. (Note: the node's `eventBcs` is *not* the
 * struct BCS — it is wrapped in a type-tag envelope whose first 32 bytes are the
 * package id, so decoding it mis-reads `escrow_id`; `contents.bcs` is the right
 * field. Confirmed live.) The indexer's `json` is kept as a fallback for events
 * we don't model or whose bytes don't fit the codegen layout.
 */
import { fromBase64 } from '@mysten/sui/utils';
import * as assetState from '../codegen/usufruct/asset_state.js';
import * as earningsMessage from '../codegen/usufruct/earnings_message.js';
import * as feeMessage from '../codegen/usufruct/fee_message.js';
import * as governanceCap from '../codegen/usufruct/governance_cap.js';
import * as usufructCap from '../codegen/usufruct/usufruct_cap.js';
import * as policyEnsemble from '../codegen/usufruct/policy_ensemble.js';

/** A typed event: the BCS-decoded payload plus metadata. */
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
  /** Decoded payload — codegen-typed via `contents.bcs`, else the indexer json. */
  readonly data: T;
  /** The raw indexer json payload (always present; fallback for unknown types). */
  readonly json: Record<string, unknown>;
}

interface EventDecoder {
  parse(bytes: Uint8Array): unknown;
}

/** `module::Name` → its codegen BCS struct. Every emitted protocol event. */
const REGISTRY: Readonly<Record<string, EventDecoder>> = {
  'asset_state::RentStarted': assetState.RentStarted,
  'asset_state::AuctionExpired': assetState.AuctionExpired,
  'asset_state::CycleParamsResolved': assetState.CycleParamsResolved,
  'asset_state::AssetRetired': assetState.AssetRetired,
  'asset_state::RetireCommitmentExtended': assetState.RetireCommitmentExtended,
  'asset_state::EnsembleCommitmentExtended': assetState.EnsembleCommitmentExtended,
  'asset_state::AssetIntegrated': assetState.AssetIntegrated,
  'asset_state::AssetClaimed': assetState.AssetClaimed,
  'asset_state::BidPlaced': assetState.BidPlaced,
  'asset_state::BidSuperseded': assetState.BidSuperseded,
  'asset_state::HandoverCompleted': assetState.HandoverCompleted,
  'asset_state::TenureExpired': assetState.TenureExpired,
  'asset_state::RetireFlagSet': assetState.RetireFlagSet,
  'asset_state::AssetBorrowed': assetState.AssetBorrowed,
  'asset_state::AssetReturned': assetState.AssetReturned,
  'asset_state::ActiveUsufructuaryRefundAddressUpdated':
    assetState.ActiveUsufructuaryRefundAddressUpdated,
  'asset_state::PendingUsufructuaryRefundAddressUpdated':
    assetState.PendingUsufructuaryRefundAddressUpdated,
  'earnings_message::EarningsMessagePosted': earningsMessage.EarningsMessagePosted,
  'earnings_message::EarningsMessageCollected': earningsMessage.EarningsMessageCollected,
  'fee_message::FeeMessagePosted': feeMessage.FeeMessagePosted,
  'fee_message::FeeMessageCollected': feeMessage.FeeMessageCollected,
  'governance_cap::GovernanceCapMinted': governanceCap.GovernanceCapMinted,
  'governance_cap::GovernanceCapBurned': governanceCap.GovernanceCapBurned,
  'usufruct_cap::UsufructCapMinted': usufructCap.UsufructCapMinted,
  'usufruct_cap::UsufructCapBurned': usufructCap.UsufructCapBurned,
  'policy_ensemble::PolicyEnsembleRegistered': policyEnsemble.PolicyEnsembleRegistered,
  'policy_ensemble::EnsembleUpdated': policyEnsemble.EnsembleUpdated,
  'policy_ensemble::EnsembleUpdateScheduled': policyEnsemble.EnsembleUpdateScheduled,
};

/**
 * BCS-decode an event's `contents.bcs` via the registry. `null` if the type is
 * unknown *or* the bytes don't fit the codegen layout (deeply nested policy
 * structs may not round-trip) — the json fallback covers those.
 */
export function decodeEvent(type: string, contentsBcs: string): Record<string, unknown> | null {
  const dec = REGISTRY[eventKey(type)];
  if (!dec) return null;
  try {
    return dec.parse(fromBase64(contentsBcs)) as Record<string, unknown>;
  } catch {
    return null;
  }
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
  bcs: string | null;
  json: Record<string, unknown>;
}): TypedEvent {
  const key = eventKey(node.type);
  const decoded = node.bcs ? decodeEvent(node.type, node.bcs) : null;
  return {
    type: node.type,
    module: key.split('::')[0]!,
    name: key.split('::')[1] ?? key,
    sender: node.sender,
    timestamp: node.timestamp,
    escrowId: escrowIdOf(decoded) ?? escrowIdOf(node.json),
    data: decoded ?? node.json,
    json: node.json,
  };
}
