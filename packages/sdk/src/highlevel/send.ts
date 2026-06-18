/**
 * Transaction execution (Layer 2). One place that signs, sends, waits, and
 * exposes effects — so handles return typed receipts, not raw effect blobs.
 *
 * `execute` is the built-in path (sign with a held `Signer`). `Executor` is the
 * pluggable seam: a write builds a PTB and delegates *how* it is executed — a
 * browser wallet (`walletExecutor`), a Ledger, a sponsored two-signature flow,
 * an offline signer are all just a different `Executor`. The default
 * (`signerExecutor`) wraps a `Signer`, preserving today's behavior.
 *
 * Note the asymmetry that shapes the wallet path: the *enrichment* of a result
 * (`effects` + `objectTypes`, which the rich decodes need — see
 * `createdIdByType`) is the SDK's job, produced by passing `include` to the core
 * API. A browser wallet's own sign-and-execute returns no `objectTypes`, so the
 * wallet only **signs** and the SDK **executes** the signed bytes here.
 */
import type { ClientWithCoreApi, SuiClientTypes } from '@mysten/sui/client';
import type { Signer } from '@mysten/sui/cryptography';
import type { Transaction } from '@mysten/sui/transactions';
import { fromBase64 } from '@mysten/sui/utils';
import { mapAbort } from './errors.js';

export type ExecResult = SuiClientTypes.Transaction<{
  effects: true;
  objectTypes: true;
}>;

/** The result union the core API returns from a (sign-and-)execute call. */
type ExecOutcome =
  | { readonly $kind: 'Transaction'; readonly Transaction: ExecResult }
  | {
      readonly $kind: 'FailedTransaction';
      readonly FailedTransaction: { readonly status: { readonly error: unknown }; readonly digest: string };
    };

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

/**
 * The slice of a browser wallet the SDK needs: sign a built transaction and
 * return its bytes + signature. `@mysten/dapp-kit`'s instance (`useDAppKit()` /
 * `createDAppKit()`) and any wallet-standard `signTransaction` satisfy this
 * structurally — so the SDK adapts to a wallet WITHOUT depending on dapp-kit.
 */
export interface WalletSigner {
  signTransaction(input: {
    transaction: Transaction;
  }): Promise<{ bytes: string; signature: string }>;
}

/**
 * Executor backed by a browser wallet (Slush, Suiet, …). The wallet only
 * **signs**; the SDK **executes** the signed bytes through its own client with
 * full enrichment (`effects` + `objectTypes`), so `Plan.decode` is byte-identical
 * to the held-`Signer` path. A wallet's own sign-and-execute is deliberately not
 * used: it returns no `objectTypes` (and `effects` may be null), which the rich
 * decodes (`integrate`, `rent`, `claim`) require. Execution + enrichment stays
 * the SDK's job; only signing is delegated.
 *
 * `account` is the connected account (e.g. `useCurrentAccount()`); its address is
 * the build-time sender.
 */
export function walletExecutor(
  client: ClientWithCoreApi,
  wallet: WalletSigner,
  account: { readonly address: string },
): Executor {
  return {
    address: account.address,
    execute: async (tx) => {
      const { bytes, signature } = await wallet.signTransaction({ transaction: tx });
      return executeSigned(client, bytes, [signature]).catch(mapAbort);
    },
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
  return finishExecution(client, result);
}

/**
 * Execute pre-signed transaction bytes (the wallet/offline path). `transaction`
 * is the base64 BCS the wallet returns (`signTransaction().bytes`). The SDK passes
 * `include` so the result is enriched the same as {@link execute} — the decode is
 * identical regardless of who signed.
 */
export async function executeSigned(
  client: ClientWithCoreApi,
  transaction: string,
  signatures: string[],
): Promise<ExecResult> {
  const result = await client.core.executeTransaction({
    transaction: fromBase64(transaction),
    signatures,
    include: { effects: true, objectTypes: true },
  });
  return finishExecution(client, result);
}

/** Unwrap the result union, wait for finality, assert on-chain success. */
async function finishExecution(client: ClientWithCoreApi, result: ExecOutcome): Promise<ExecResult> {
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
