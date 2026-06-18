/**
 * `collect` — the mirror (off-chain `step`), paired with the core's
 * `collectMessagesToPtb`.
 *
 * `Transition` over the inbox aggregate (`MessageGroups`, SPEC §4.3 as
 * amended): `step` drains the discovered groups and totals per coin — the pure
 * mirror of what the partitioned PTB does on-chain. The `toPtb` interpretation
 * is the core's drift-free builder.
 */
import type { Transaction, TransactionResult } from '@mysten/sui/transactions';
import {
  collectMessagesToPtb,
  type CollectParams,
  type CollectPtbArgs,
  type MessageGroups,
} from '@usufruct-protocol/sdk/actions/collect.js';
import { mist, type Mist } from '@usufruct-protocol/sdk/primitives/brand.js';
import type { TransitionAction } from '../../primitives/action.js';

export interface CollectStepResult {
  readonly byCoin: ReadonlyArray<{
    readonly coinType: string;
    readonly count: number;
    readonly amountMist: Mist;
  }>;
}

/**
 * The full collect action: the `step` mirror paired with the core's
 * `collectMessagesToPtb`. (Variant deviation: the PTB interpretation yields one
 * `Coin<C>` per coin, hence `toPtb` returns an array.)
 */
export interface CollectAction
  extends Omit<TransitionAction<CollectStepResult, CollectPtbArgs, MessageGroups>, 'toPtb'> {
  readonly toPtb: (tx: Transaction, args: CollectPtbArgs) => TransactionResult[];
}

export function collectMessages(params: CollectParams): CollectAction {
  return {
    step: (groups) => {
      const byCoin = [...groups].map(([coinType, refs]) => ({
        coinType,
        count: refs.length,
        amountMist: mist(refs.reduce((a, r) => a + r.amountMist, 0n)),
      }));
      return { state: new Map(), result: { byCoin } };
    },
    toPtb: collectMessagesToPtb(params),
  };
}
