/**
 * In-memory inbox aggregate (SPEC §5.2 / §6.5) — the testbed counterpart of the
 * earnings / fee mailbox. The inbox is a *different* aggregate from the escrow:
 * its actions fold over `MessageGroups` (coin type → messages), keyed by the
 * inbox *object* id, not the escrow. Messages are transfer-to-object on-chain;
 * here they are entries in a `Map`. `fetch` mirrors `discoverInboxMessages`
 * (partition by coin type, §5.2) and `collect` reuses `collectMessages().step`
 * — the same fold the chain runs — so the off-chain economy is bit-faithful.
 *
 * The escrow and the inbox are bridged by `postSettlement`: when an escrow
 * settles a handover/tenure, 90% of the consumed credit goes to the governor's
 * earnings inbox and 10% to the protocol fee inbox. Applying that bridge after
 * an escrow `apply` closes the 90/10 loop entirely in RAM — the conservation
 * the live e2e proves (`collected == posted`) becomes an offline assertion.
 */
import { normalizeStructTag } from '@mysten/sui/utils';
import {
  collectMessages,
  type CollectStepResult,
  type MessageGroups,
  type MessageRef,
} from '@usufruct-protocol/sdk/actions/collect.js';
import type { Mist, Ms } from '@usufruct-protocol/sdk/primitives/brand.js';
import { mist } from '@usufruct-protocol/sdk/primitives/brand.js';

/** Canonical inbox id form (`0x`-insensitive), matching the other stores. */
function normId(s: string): string {
  return s.replace(/^0x/, '').toLowerCase().replace(/^0+/, '');
}

/**
 * An in-memory mailbox, keyed by inbox object id, holding coin-polymorphic
 * messages. Mirrors the chain's discovery + collect without any network.
 */
export interface MemoryInbox {
  /** Insert a message into an inbox (any coin type — one inbox, many coins). */
  post(inboxId: string, msg: { coinType: string; amountMist: Mist }): void;
  /** The inbox's messages partitioned by coin type — the `discover` mirror. */
  fetch(inboxId: string): MessageGroups;
  /** Drain the inbox and total per coin — the `collectMessages().step` mirror. */
  collect(inboxId: string, t: Ms): CollectStepResult;
  has(inboxId: string): boolean;
  delete(inboxId: string): void;
  readonly size: number;
}

/** Build an in-memory inbox, optionally seeded with `{ inboxId, groups }`. */
export function memoryInbox(
  seed?: Iterable<{ inboxId: string; groups: MessageGroups }>,
): MemoryInbox {
  // inbox id → (coin type → messages). Mirrors the on-chain partition.
  const store = new Map<string, Map<string, MessageRef[]>>();
  let seq = 0;

  const inbox: MemoryInbox = {
    post(inboxId, msg) {
      const n = normId(inboxId);
      const coin = normalizeStructTag(msg.coinType);
      const groups = store.get(n) ?? new Map<string, MessageRef[]>();
      const bucket = groups.get(coin) ?? [];
      // objectId/version/digest are synthetic — off-chain there is no real
      // ticket; only the coin type and amount drive the fold.
      bucket.push({
        objectId: `0xmem${(++seq).toString(16)}`,
        version: '1',
        digest: 'mem',
        amountMist: msg.amountMist,
      });
      groups.set(coin, bucket);
      store.set(n, groups);
    },

    fetch(inboxId) {
      return store.get(normId(inboxId)) ?? new Map<string, MessageRef[]>();
    },

    collect(inboxId, t) {
      const groups = inbox.fetch(inboxId);
      // `kind` is irrelevant to the off-chain fold (step ignores it; it only
      // selects the PTB module in `toPtb`). Reuse the canonical totaliser.
      const { result } = collectMessages({ kind: 'earnings', groups }).step(groups, t);
      store.delete(normId(inboxId));
      return result;
    },

    has(inboxId) {
      return store.has(normId(inboxId));
    },

    delete(inboxId) {
      store.delete(normId(inboxId));
    },

    get size() {
      return store.size;
    },
  };

  for (const { inboxId, groups } of seed ?? []) {
    for (const [coinType, refs] of groups) {
      for (const ref of refs) inbox.post(inboxId, { coinType, amountMist: ref.amountMist });
    }
  }

  return inbox;
}

/**
 * The escrow ↔ inbox bridge (SPEC: 90% → earnings, 10% → protocol fee). Posts a
 * settled escrow's split into the two inboxes, closing the economy off-chain.
 * Opt-in — `memorySource` stays unaware of inboxes.
 */
export function postSettlement(
  inbox: MemoryInbox,
  ids: { earningsId: string; feeId: string },
  coinType: string,
  settlement: { governorShareMist: Mist; feeMist: Mist },
): void {
  if (settlement.governorShareMist > 0n)
    inbox.post(ids.earningsId, { coinType, amountMist: mist(settlement.governorShareMist) });
  if (settlement.feeMist > 0n)
    inbox.post(ids.feeId, { coinType, amountMist: mist(settlement.feeMist) });
}
