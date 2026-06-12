/**
 * Coin-polymorphic inbox collection (SPEC §5.2).
 *
 * The inboxes are NOT generic over CoinType: one inbox aggregates
 * `EarningsMessage<C>` / `FeeMessage<C>` for every coin the governor rents
 * in. A `Receiving<T>` ticket is opaque — a mismatched coin type aborts deep
 * inside `0x2::transfer::receive_impl` at runtime, so the type discipline
 * must live here: discovery partitions the messages by fully-qualified coin
 * type, and `toPtb` emits one collect call per coin, never mixing tickets.
 *
 * Discovery is IO (Source-adjacent); `toPtb` is pure over the discovered
 * groups. Note for SPEC: inbox actions do not operate on an `EscrowState`,
 * so they fit none of the three §4.3 lifecycle variants — observation
 * recorded, classification deferred.
 */
import type { ClientWithCoreApi } from '@mysten/sui/client';
import type { Transaction, TransactionResult } from '@mysten/sui/transactions';
import { normalizeStructTag } from '@mysten/sui/utils';
import { collectEarningsMessages } from '../codegen/usufruct/earnings.js';
import { collectFeeMessages } from '../codegen/usufruct/fees.js';
import type { Id } from '../primitives/brand.js';
import type { PackageIds } from '../config/network.js';

export type InboxKind = 'earnings' | 'fees';

export interface MessageRef {
  readonly objectId: string;
  readonly version: string;
  readonly digest: string;
}

/** Messages grouped by normalized fully-qualified coin type. */
export type MessageGroups = ReadonlyMap<string, readonly MessageRef[]>;

const MESSAGE_TYPE: Record<InboxKind, { module: string; struct: string }> = {
  earnings: { module: 'earnings_message', struct: 'EarningsMessage' },
  fees: { module: 'fee_message', struct: 'FeeMessage' },
};

/**
 * Discover the messages sitting in an inbox (transfer-to-object: they are
 * owned by the inbox's id), partitioned by coin type.
 */
export async function discoverInboxMessages(
  client: ClientWithCoreApi,
  inboxId: Id<'EarningsInbox'> | Id<'ProtocolFeeInbox'> | string,
  kind: InboxKind,
): Promise<MessageGroups> {
  const frag = `::${MESSAGE_TYPE[kind].module}::${MESSAGE_TYPE[kind].struct}<`;
  const groups = new Map<string, MessageRef[]>();
  let cursor: string | null = null;
  do {
    const page: Awaited<ReturnType<typeof client.core.listOwnedObjects>> =
      await client.core.listOwnedObjects({ owner: inboxId, cursor, limit: 50 });
    for (const obj of page.objects) {
      if (!obj.type.includes(frag)) continue;
      const coin = normalizeStructTag(singleTypeArg(obj.type));
      const refs = groups.get(coin) ?? [];
      refs.push({ objectId: obj.objectId, version: obj.version, digest: obj.digest });
      groups.set(coin, refs);
    }
    cursor = page.hasNextPage ? page.cursor : null;
  } while (cursor);
  return groups;
}

/** The single type argument of a one-generic type tag (e.g. a message). */
function singleTypeArg(type: string): string {
  const open = type.indexOf('<');
  if (open === -1 || !type.endsWith('>')) {
    throw new Error(`Not a generic type tag: ${type}`);
  }
  const inner = type.slice(open + 1, -1).trim();
  let depth = 0;
  for (const ch of inner) {
    if (ch === '<') depth++;
    else if (ch === '>') depth--;
    else if (ch === ',' && depth === 0) {
      throw new Error(`Expected one type argument in: ${type}`);
    }
  }
  return inner;
}

export interface CollectPtbArgs {
  readonly pkg: Pick<PackageIds, 'packageId'>;
  readonly inboxId: string;
}

export interface CollectParams {
  readonly kind: InboxKind;
  readonly groups: MessageGroups;
}

export interface CollectAction {
  /**
   * Emits one collect call per discovered coin type in a single PTB and
   * returns the resulting `Coin<C>` per coin (insertion order of `groups`);
   * the caller transfers or consumes them.
   */
  readonly toPtb: (tx: Transaction, args: CollectPtbArgs) => TransactionResult[];
}

export function collectMessages(params: CollectParams): CollectAction {
  const { module, struct } = MESSAGE_TYPE[params.kind];
  return {
    toPtb: (tx, args) => {
      const coins: TransactionResult[] = [];
      for (const [coinType, refs] of params.groups) {
        if (refs.length === 0) continue;
        const tickets = refs.map((r) => tx.receivingRef(r));
        const vec = tx.makeMoveVec({
          type: `0x2::transfer::Receiving<${args.pkg.packageId}::${module}::${struct}<${coinType}>>`,
          elements: tickets,
        });
        const call =
          params.kind === 'earnings'
            ? collectEarningsMessages({
                package: args.pkg.packageId,
                arguments: [args.inboxId, vec],
                typeArguments: [coinType],
              })
            : collectFeeMessages({
                package: args.pkg.packageId,
                arguments: [args.inboxId, vec],
                typeArguments: [coinType],
              });
        coins.push(tx.add(call));
      }
      return coins;
    },
  };
}
