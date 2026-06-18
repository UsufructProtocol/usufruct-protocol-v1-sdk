import type { ClientWithCoreApi } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { describe, expect, it } from 'vitest';
import {
  createdIdByType,
  executeSigned,
  walletExecutor,
  type ExecResult,
  type WalletSigner,
} from '@usufruct-protocol/sdk/highlevel/send.js';

// A wallet that only signs — returns canned bytes (base64 of [1,2,3]) + signature,
// like @mysten/dapp-kit's signTransaction. It ignores the tx; we assert the SDK
// forwards what it returns.
const wallet: WalletSigner = {
  signTransaction: async () => ({ bytes: 'AQID', signature: 'sig-1' }),
};

// The enriched result the SDK's own executeTransaction produces (effects + objectTypes).
const CAP = '0xcap';
const enriched = {
  digest: '0xdigest',
  status: { success: true, error: null },
  effects: { changedObjects: [{ objectId: CAP, idOperation: 'Created' }] },
  objectTypes: { [CAP]: '0xpkg::usufruct_cap::UsufructCap' },
} as unknown as ExecResult;

/** A fake client whose core.executeTransaction records its args and returns `outcome`. */
function fakeClient(outcome: unknown): { client: ClientWithCoreApi; calls: { execute: any[]; waited: string[] } } {
  const calls = { execute: [] as any[], waited: [] as string[] };
  const client = {
    core: {
      executeTransaction: async (args: unknown) => {
        calls.execute.push(args);
        return outcome;
      },
      waitForTransaction: async (args: { digest: string }) => {
        calls.waited.push(args.digest);
      },
    },
  } as unknown as ClientWithCoreApi;
  return { client, calls };
}

describe('walletExecutor — wallet signs, SDK executes + enriches', () => {
  it('address is the connected account', () => {
    const { client } = fakeClient({ $kind: 'Transaction', Transaction: enriched });
    const ex = walletExecutor(client, wallet, { address: '0xabc' });
    expect(ex.address).toBe('0xabc');
  });

  it('forwards the wallet bytes+signature to executeTransaction with enrichment include', async () => {
    const { client, calls } = fakeClient({ $kind: 'Transaction', Transaction: enriched });
    const ex = walletExecutor(client, wallet, { address: '0xabc' });

    const res = await ex.execute(new Transaction());

    expect(calls.execute).toHaveLength(1);
    const arg = calls.execute[0];
    expect(arg.signatures).toEqual(['sig-1']);
    expect(arg.include).toEqual({ effects: true, objectTypes: true });
    // base64 'AQID' → Uint8Array([1,2,3]) (the SDK decodes for the core API).
    expect(Array.from(arg.transaction as Uint8Array)).toEqual([1, 2, 3]);
    // waited for finality on the returned digest.
    expect(calls.waited).toEqual(['0xdigest']);
    // result is the enriched ExecResult — decode is identical to the Signer path.
    expect(res.digest).toBe('0xdigest');
  });

  it('produces a result the rich decode can read (objectTypes + effects)', async () => {
    const { client } = fakeClient({ $kind: 'Transaction', Transaction: enriched });
    const ex = walletExecutor(client, wallet, { address: '0xabc' });
    const res = await ex.execute(new Transaction());
    expect(createdIdByType(res, '::usufruct_cap::')).toBe(CAP);
  });

  it('throws a descriptive error when the chain reports a failed transaction', async () => {
    const { client } = fakeClient({
      $kind: 'FailedTransaction',
      FailedTransaction: { status: { error: 'boom' }, digest: '0xfail' },
    });
    const ex = walletExecutor(client, wallet, { address: '0xabc' });
    await expect(ex.execute(new Transaction())).rejects.toThrow(/tx failed.*0xfail/);
  });

  it('executeSigned decodes base64 bytes and returns the enriched result', async () => {
    const { client, calls } = fakeClient({ $kind: 'Transaction', Transaction: enriched });
    const res = await executeSigned(client, 'AQID', ['sig-1']);
    expect(Array.from(calls.execute[0].transaction as Uint8Array)).toEqual([1, 2, 3]);
    expect(res.digest).toBe('0xdigest');
  });
});
