/**
 * Escrow history (Layer 2) — the high-level over the indexer's escrow timeline.
 *
 * An escrow's lifecycle is a stream of events keyed by `escrow_id`. The indexer
 * already fans them out, decodes them, and orders them by time (`escrowTimeline`).
 * This is the ergonomic projection: a `HistoryEvent` with a friendly `kind`, the
 * emission time, the tx sender, and the decoded fields — no `module::Name` strings,
 * no BCS, no manual merge.
 */
import type { TypedEvent } from '../indexer/events.js';

/** One thing that happened to an escrow. */
export interface HistoryEvent {
  /** The event name, e.g. `'RentStarted'`, `'BidPlaced'`, `'HandoverCompleted'`. */
  readonly kind: string;
  /** Its Move module, e.g. `'asset_state'`, `'earnings_message'`. */
  readonly module: string;
  /** Emission time, or `null`. The list is ordered by this. */
  readonly at: Date | null;
  /** The transaction sender that caused it (governor / renter / bidder / keeper). */
  readonly by: string | null;
  /** The event's decoded fields (codegen-typed where known, else the indexer json). */
  readonly data: Record<string, unknown>;
}

/** Project a kernel `TypedEvent` into a high-level {@link HistoryEvent}. */
export function toHistoryEvent(ev: TypedEvent): HistoryEvent {
  return {
    kind: ev.name,
    module: ev.module,
    at: ev.timestamp ? new Date(ev.timestamp) : null,
    by: ev.sender,
    data: (ev.data ?? ev.json) as Record<string, unknown>,
  };
}
