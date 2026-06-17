/**
 * Transaction execution (Layer 2). One place that signs, sends, waits, and
 * exposes effects — so handles return typed receipts, not raw effect blobs.
 *
 * `execute` is the built-in path (sign with a held `Signer`). `Executor` is the
 * pluggable seam: a write builds a PTB and delegates *how* it is executed — a
 * browser wallet, a Ledger, a sponsored two-signature flow, an offline signer
 * are all just a different `Executor`. The default (`signerExecutor`) wraps a
 * `Signer`, preserving today's behavior.
 */
import type { ClientWithCoreApi, SuiClientTypes } from '@mysten/sui/client';
import type { Signer } from '@mysten/sui/cryptography';
import type { Transaction } from '@mysten/sui/transactions';
import { mapAbort } from './errors.js';

export type ExecResult = SuiClientTypes.Transaction<{
  effects: true;
  objectTypes: true;
}>;

/**
 * How a built transaction gets executed. `address` is the sender — a write needs
 * it at *build* time (coin sourcing, `transferObjects`), and it is public, so it
 * is known without holding keys (a wallet/Ledger exposes it). `execute` is the
 * *execute*-time act: sign + send + wait.
 */
export interface Executor {
  readonly address: string;
  execute(tx: Transaction): Promise<ExecResult>;
}

/** The default executor: sign with a held `Signer` (today's path), abort-mapped. */
export function signerExecutor(client: ClientWithCoreApi, signer: Signer): Executor {
  return {
    address: signer.toSuiAddress(),
    execute: (tx) => execute(client, tx, signer).catch(mapAbort),
  };
}

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
