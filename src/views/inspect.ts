/**
 * Pattern A reads (SPEC §6.2): curve/settlement math evaluated by the
 * deployed Move bytecode via `simulateTransaction`, decoded from BCS return
 * values. These are IO — deliberately *not* `View<T>`; they take a client.
 *
 * Used for math whose bit-exact TypeScript replication carries drift risk.
 */
import { bcs } from '@mysten/sui/bcs';
import type { ClientWithCoreApi } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import * as escrowCalls from '../codegen/usufruct/escrow.js';
import type { Id, Mist, Ms } from '../primitives/brand.js';
import { mist } from '../primitives/brand.js';

export interface InspectTarget {
  readonly client: ClientWithCoreApi;
  /** The deployed usufruct package id. */
  readonly packageId: string;
  readonly escrowId: Id<'Escrow'>;
  /** `[assetType, coinType]` — as carried by `EscrowState`. */
  readonly typeArguments: [string, string];
}

async function inspectU64(
  target: InspectTarget,
  call: (tx: Transaction) => void,
): Promise<bigint> {
  const tx = new Transaction();
  call(tx);
  const result = await target.client.core.simulateTransaction({
    transaction: tx,
    checksEnabled: false,
    include: { commandResults: true },
  });
  if (result.$kind !== 'Transaction') {
    throw new Error(
      `Pattern A inspect failed: ${result.FailedTransaction?.status.error?.message ?? 'unknown'}`,
    );
  }
  const ret = result.commandResults?.[0]?.returnValues?.[0];
  if (!ret) throw new Error('Pattern A inspect returned no value');
  return BigInt(bcs.u64().parse(ret.bcs));
}

/** On-chain `escrow::accrued_credit_mist(escrow, now_ms)`. */
export function accruedCreditMist(target: InspectTarget, t: Ms): Promise<Mist> {
  return inspectU64(target, (tx) =>
    tx.add(
      escrowCalls.accruedCreditMist({
        package: target.packageId,
        arguments: [target.escrowId, t],
        typeArguments: target.typeArguments,
      }),
    ),
  ).then(mist);
}

/** On-chain `escrow::floor_price_mist(escrow, now_ms)`. */
export function floorPriceMist(target: InspectTarget, t: Ms): Promise<Mist> {
  return inspectU64(target, (tx) =>
    tx.add(
      escrowCalls.floorPriceMist({
        package: target.packageId,
        arguments: [target.escrowId, t],
        typeArguments: target.typeArguments,
      }),
    ),
  ).then(mist);
}
