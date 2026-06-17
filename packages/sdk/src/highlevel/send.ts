/**
 * Transaction execution (Layer 2). One place that signs, sends, waits, and
 * exposes effects — so handles return typed receipts, not raw effect blobs.
 */
import type { ClientWithCoreApi, SuiClientTypes } from '@mysten/sui/client';
import type { Signer } from '@mysten/sui/cryptography';
import type { Transaction } from '@mysten/sui/transactions';

export type ExecResult = SuiClientTypes.Transaction<{
  effects: true;
  objectTypes: true;
}>;

/** Sign, execute, and wait — throwing a descriptive error on failure. */
export async function execute(
  client: ClientWithCoreApi,
  tx: Transaction,
  signer: Signer,
): Promise<ExecResult> {
  tx.setSenderIfNotSet(signer.toSuiAddress());
  const result = await client.core.signAndExecuteTransaction({
    transaction: tx,
    signer,
    include: { effects: true, objectTypes: true },
  });
  if (result.$kind !== 'Transaction') {
    const failed = result.FailedTransaction;
    throw new Error(`tx failed: ${JSON.stringify(failed?.status.error)} digest=${failed?.digest}`);
  }
  const res = result.Transaction;
  await client.core.waitForTransaction({ digest: res.digest });
  if (!res.status.success) {
    throw new Error(`tx failed: ${JSON.stringify(res.status.error)} digest=${res.digest}`);
  }
  return res;
}

/** Id of the single object created in `res` whose type contains `frag`, or `null`. */
export function createdIdByType(res: ExecResult, frag: string): string | null {
  for (const ch of res.effects?.changedObjects ?? []) {
    if (ch.idOperation !== 'Created') continue;
    if (res.objectTypes?.[ch.objectId]?.includes(frag)) return ch.objectId;
  }
  return null;
}
