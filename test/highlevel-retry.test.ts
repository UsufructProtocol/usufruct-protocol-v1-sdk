import { describe, expect, it, vi } from 'vitest';
import type { ClientWithCoreApi } from '@mysten/sui/client';
import type { Reader } from '@usufruct-protocol/sdk/read/reader.js';
import {
  isTransientNetwork,
  isTransientRead,
  isTransientRequest,
  isTransientStatus,
  isTruncatedRead,
  retryingClient,
  retryingReader,
  withRetry,
} from '@usufruct-protocol/sdk/highlevel/retry.js';

// Instant sleep — keeps the tests off the wall clock entirely.
const noSleep = () => Promise.resolve();

// A status error as the @mysten transport surfaces it.
const statusErr = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });
// The truncated-simulateTransaction shape: indexing into a short commandResults.
const truncatedErr = () =>
  new TypeError("Cannot read properties of undefined (reading 'returnValues')");
// undici's network failure shape — observed live as UND_ERR_CONNECT_TIMEOUT.
const fetchFailedErr = (code = 'UND_ERR_CONNECT_TIMEOUT') =>
  Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('timeout'), { code }) });

describe('highlevel/retry — predicates', () => {
  it('isTransientStatus matches 429/502/503/504 only', () => {
    for (const s of [429, 502, 503, 504]) expect(isTransientStatus(statusErr(s))).toBe(true);
    expect(isTransientStatus(statusErr(400))).toBe(false);
    expect(isTransientStatus(statusErr(500))).toBe(false);
    expect(isTransientStatus(new Error('move abort: EAssetNotAvailable'))).toBe(false);
    expect(isTransientStatus({ cause: { status: 429 } })).toBe(true); // nested
  });

  it('isTransientNetwork matches undici fetch-failed / timeouts / resets', () => {
    expect(isTransientNetwork(fetchFailedErr('UND_ERR_CONNECT_TIMEOUT'))).toBe(true);
    expect(isTransientNetwork(fetchFailedErr('ECONNRESET'))).toBe(true);
    expect(isTransientNetwork(Object.assign(new Error('x'), { code: 'ETIMEDOUT' }))).toBe(true);
    expect(isTransientNetwork(new TypeError('fetch failed'))).toBe(true); // bare, no cause
    expect(isTransientNetwork(new TypeError('something else'))).toBe(false);
    expect(isTransientNetwork(new Error('move abort'))).toBe(false);
  });

  it('isTransientRequest is status OR network', () => {
    expect(isTransientRequest(statusErr(429))).toBe(true);
    expect(isTransientRequest(fetchFailedErr())).toBe(true);
    expect(isTransientRequest(new Error('deterministic'))).toBe(false);
  });

  it('isTruncatedRead matches the empty/truncated simulateTransaction forms', () => {
    expect(isTruncatedRead(truncatedErr())).toBe(true);
    expect(isTruncatedRead(new TypeError('reading commandResults of undefined'))).toBe(true);
    // the JSON-RPC client's empty-result form (a plain Error, confirmed live)
    expect(isTruncatedRead(new Error('simulateTransaction failed: no results from dryRun or devInspect'))).toBe(true);
    expect(isTruncatedRead(new Error("reading 'returnValues'"))).toBe(false); // TypeError-only for that form
    expect(isTruncatedRead(statusErr(429))).toBe(false);
    expect(isTruncatedRead(new Error('read(accruedCreditMist) failed: move abort'))).toBe(false); // deterministic
    expect(isTruncatedRead(new TypeError('something unrelated'))).toBe(false);
  });

  it('isTransientRead is the full union (request + truncated)', () => {
    expect(isTransientRead(statusErr(503))).toBe(true);
    expect(isTransientRead(fetchFailedErr())).toBe(true);
    expect(isTransientRead(truncatedErr())).toBe(true);
    expect(isTransientRead(new Error('deterministic'))).toBe(false);
  });
});

describe('highlevel/retry — withRetry', () => {
  it('retries a transient throw then succeeds, sleeping between tries', async () => {
    const sleep = vi.fn(noSleep);
    let calls = 0;
    const out = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw statusErr(429);
        return 'ok';
      },
      { sleep, baseMs: 1 },
    );
    expect(out).toBe('ok');
    expect(calls).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2); // two backoffs before the win
  });

  it('rethrows the original error after exhausting attempts', async () => {
    const err = statusErr(503);
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw err;
        },
        { attempts: 4, sleep: noSleep, baseMs: 1 },
      ),
    ).rejects.toBe(err);
    expect(calls).toBe(4);
  });

  it('does NOT retry a non-retryable error — fails fast, no sleep', async () => {
    const sleep = vi.fn(noSleep);
    const abort = new Error('move abort');
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw abort;
        },
        { sleep, baseMs: 1 }, // default predicate = isTransientStatus
      ),
    ).rejects.toBe(abort);
    expect(calls).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe('highlevel/retry — retryingClient (reads retry, execution never)', () => {
  it('retries an idempotent read on transient status', async () => {
    let getCalls = 0;
    const client = {
      core: {
        getObject: async () => {
          getCalls++;
          if (getCalls < 2) throw statusErr(429);
          return { object: { objectId: '0x1' } };
        },
      },
    } as unknown as ClientWithCoreApi;

    const wrapped = retryingClient(client, { sleep: noSleep, baseMs: 1 });
    const res = (await wrapped.core.getObject({ objectId: '0x1' } as never)) as {
      object: { objectId: string };
    };
    expect(res.object.objectId).toBe('0x1');
    expect(getCalls).toBe(2); // retried once
  });

  it('retries an idempotent read on a transient network error (fetch failed)', async () => {
    let calls = 0;
    const client = {
      core: {
        getObject: async () => {
          calls++;
          if (calls < 2) throw fetchFailedErr('UND_ERR_CONNECT_TIMEOUT');
          return { object: { objectId: '0x6' } };
        },
      },
    } as unknown as ClientWithCoreApi;
    const wrapped = retryingClient(client, { sleep: noSleep, baseMs: 1 });
    const res = (await wrapped.core.getObject({ objectId: '0x6' } as never)) as {
      object: { objectId: string };
    };
    expect(res.object.objectId).toBe('0x6');
    expect(calls).toBe(2);
  });

  it('NEVER retries execution — signAndExecuteTransaction throws at once', async () => {
    let execCalls = 0;
    const client = {
      core: {
        signAndExecuteTransaction: async () => {
          execCalls++;
          throw statusErr(429);
        },
      },
    } as unknown as ClientWithCoreApi;

    const wrapped = retryingClient(client, { sleep: noSleep, baseMs: 1 });
    await expect(
      (wrapped.core as unknown as { signAndExecuteTransaction: () => Promise<unknown> }).signAndExecuteTransaction(),
    ).rejects.toMatchObject({ status: 429 });
    expect(execCalls).toBe(1); // not retried — a retried submit could double-execute
  });

  it('preserves `this` for methods using private fields (retried AND pass-through)', async () => {
    // The real gRPC core uses private `#client` fields; a proxy that returns
    // bare functions breaks them (this=proxy). Bind to the real target instead.
    class FakeCore {
      readonly #secret = 'bound';
      async getObject() {
        return { object: { id: this.#secret } }; // read — retried branch
      }
      async signAndExecuteTransaction() {
        return { digest: this.#secret }; // execution — pass-through branch
      }
    }
    const client = { core: new FakeCore() } as unknown as ClientWithCoreApi;
    const wrapped = retryingClient(client, { sleep: noSleep, baseMs: 1 });
    const read = (await wrapped.core.getObject({ objectId: '0x1' } as never)) as { object: { id: string } };
    expect(read.object.id).toBe('bound'); // private field reached → this bound
    const exec = await (
      wrapped.core as unknown as { signAndExecuteTransaction: () => Promise<{ digest: string }> }
    ).signAndExecuteTransaction();
    expect(exec.digest).toBe('bound'); // pass-through also bound (this is the live bug)
  });
});

describe('highlevel/retry — retryingReader (truncated reads retry, aborts do not)', () => {
  const makeReader = (impl: () => Promise<unknown>): Reader =>
    ({ isIdle: impl }) as unknown as Reader;

  it('retries the truncated-simulateTransaction shape', async () => {
    let calls = 0;
    const reader = makeReader(async () => {
      calls++;
      if (calls < 2) throw truncatedErr();
      return true;
    });
    const wrapped = retryingReader(reader, { sleep: noSleep, baseMs: 1 });
    expect(await wrapped.isIdle()).toBe(true);
    expect(calls).toBe(2);
  });

  it('does NOT retry a Move abort surfaced by a view', async () => {
    let calls = 0;
    const abort = new Error('read(accruedCreditMist) failed: move abort');
    const reader = makeReader(async () => {
      calls++;
      throw abort;
    });
    const wrapped = retryingReader(reader, { sleep: noSleep, baseMs: 1 });
    await expect(wrapped.isIdle()).rejects.toBe(abort);
    expect(calls).toBe(1);
  });
});
