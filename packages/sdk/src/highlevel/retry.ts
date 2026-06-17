/**
 * Transient-fault resilience (Layer 2). The protocol runs against the public Sui
 * fullnode, which is *flaky*: the same idempotent read intermittently fails and
 * succeeds on retry. This module makes reads reliable **by default**, with no
 * call-site changes for the consumer.
 *
 * Observed failure shapes (all confirmed live against the public node):
 *   - HTTP transient status — `429` (rate-limit), `502`/`503`/`504` gateway.
 *   - Transient network — `undici`'s `TypeError: fetch failed` with a connect /
 *     socket timeout or reset in `cause.code` (a burst surfaced
 *     `UND_ERR_CONNECT_TIMEOUT`, not 429 — the request never reached the node).
 *   - Truncated `simulateTransaction` — `commandResults` come back short, so the
 *     reader's `flattenReturns` throws `TypeError … reading 'returnValues'`.
 *
 * The kernel stays pure (`src/read/spec.ts`, `src/primitives/*` carry no retry):
 * resilience is a composition concern, applied here at the client / reader
 * boundary. The correctness boundary is strict — we retry only what is
 * **transient AND idempotent**:
 *   - reads ride through (`getObject`, `simulateTransaction`, `listOwnedObjects`,
 *     `getBalance`, …);
 *   - **execution never does** (`signAndExecuteTransaction`, `executeTransaction`)
 *     — a retried submit risks double-execution, so it propagates;
 *   - a **Move abort** or any deterministic error propagates — retrying would only
 *     hide a real failure.
 */
import type { ClientWithCoreApi } from '@mysten/sui/client';
import type { SuiGraphQLClient } from '@mysten/sui/graphql';
import type { Reader } from '../read/reader.js';

/** Tuning for {@link withRetry}. All fields optional; sensible defaults apply. */
export interface RetryOptions {
  /** Total tries before giving up (default `6`). */
  attempts?: number;
  /** First backoff in ms; doubles each retry (default `2000`). */
  baseMs?: number;
  /** Backoff ceiling in ms (default `30000`). */
  maxMs?: number;
  /** Per-error predicate: should this throw be retried? (default {@link isTransientRequest}). */
  retryable?: (err: unknown) => boolean;
  /** Injected sleep (tests pass an instant one); default is `setTimeout`. */
  sleep?: (ms: number) => Promise<void>;
  /** Observe each backoff (e.g. to log). Not called on the final, rethrown error. */
  onRetry?: (info: { error: unknown; attempt: number; delayMs: number }) => void;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** A transient HTTP status from the public fullnode (rate-limit / gateway). */
export function isTransientStatus(err: unknown): boolean {
  const status =
    (err as { status?: number } | null)?.status ??
    (err as { cause?: { status?: number } } | null)?.cause?.status;
  return status === 429 || status === 502 || status === 503 || status === 504;
}

/**
 * Transient network-layer failures observed live against the public node under
 * load — `undici`'s `TypeError: fetch failed` carrying a connect/socket timeout
 * or a reset in its `cause.code`. These never reached the node, so retrying an
 * idempotent read is safe. (Discovered live: a burst surfaced
 * `UND_ERR_CONNECT_TIMEOUT`, not HTTP 429.)
 */
const TRANSIENT_NET_CODES = new Set([
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'EPIPE',
]);
export function isTransientNetwork(err: unknown): boolean {
  const e = err as { code?: string; message?: string; cause?: { code?: string } } | null;
  const code = e?.code ?? e?.cause?.code;
  if (code != null && TRANSIENT_NET_CODES.has(code)) return true;
  // undici wraps the cause under a bare `TypeError: fetch failed`.
  return err instanceof TypeError && err.message === 'fetch failed';
}

/** Any transient request fault — HTTP status or network layer. */
export function isTransientRequest(err: unknown): boolean {
  return isTransientStatus(err) || isTransientNetwork(err);
}

/**
 * An empty / truncated `simulateTransaction` — the read came back with nothing
 * decodable. Two observed forms, both transient (the same sim succeeds on retry):
 *   - the JSON-RPC client throws `Error: simulateTransaction failed: no results
 *     from dryRun or devInspect` (confirmed live);
 *   - a short `commandResults` makes the reader index into `undefined` →
 *     `TypeError … reading 'returnValues'`.
 * Distinct from a Move abort, which surfaces as `read(<name>) failed: <abort>`.
 */
export function isTruncatedRead(err: unknown): boolean {
  const msg = (err as { message?: string } | null)?.message ?? '';
  if (msg.includes('no results from dryRun or devInspect')) return true;
  return err instanceof TypeError && (msg.includes('returnValues') || msg.includes('commandResults'));
}

/** Any transient read fault — request (status/network) or truncated parse. */
export function isTransientRead(err: unknown): boolean {
  return isTransientRequest(err) || isTruncatedRead(err);
}

/**
 * Run `fn`, retrying on a retryable throw with exponential backoff. Non-retryable
 * errors (and the final attempt) rethrow verbatim. Only ever wrap *idempotent*
 * work — see the module note.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 6;
  const baseMs = opts.baseMs ?? 2_000;
  const maxMs = opts.maxMs ?? 30_000;
  const retryable = opts.retryable ?? isTransientRequest;
  const sleep = opts.sleep ?? defaultSleep;
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= attempts - 1 || !retryable(e)) throw e;
      const delayMs = Math.min(baseMs * 2 ** i, maxMs);
      opts.onRetry?.({ error: e, attempt: i + 1, delayMs });
      await sleep(delayMs);
    }
  }
}

/** Core methods that mutate chain state — never auto-retried (idempotency). */
const NON_RETRYABLE_METHODS = new Set(['signAndExecuteTransaction', 'executeTransaction']);

/**
 * Wrap a client so every idempotent `core.*` read rides through {@link withRetry}
 * on transient status. Execution methods pass through untouched. Other properties
 * and methods are returned as-is. Use for a BYO client to get the same resilience
 * `usufruct()` applies by default.
 */
export function retryingClient(client: ClientWithCoreApi, opts: RetryOptions = {}): ClientWithCoreApi {
  const core = client.core as unknown as Record<string, unknown> | undefined;
  // Nothing to wrap (e.g. a stub client) — return as-is rather than proxy-throw.
  if (core == null || typeof core !== 'object') return client;
  const retry: RetryOptions = { ...opts, retryable: opts.retryable ?? isTransientRequest };
  const wrappedCore = new Proxy(core, {
    get(target, prop) {
      const v = target[prop as string];
      if (typeof v !== 'function') return v;
      const fn = v as (...a: unknown[]) => unknown;
      // Bind to the real core (methods use private `this` fields). Execution
      // methods are bound but NOT retried — a retried submit could double-execute.
      if (NON_RETRYABLE_METHODS.has(prop as string)) {
        return (...args: unknown[]) => fn.apply(target, args);
      }
      return (...args: unknown[]) => withRetry(() => fn.apply(target, args) as Promise<unknown>, retry);
    },
  });
  return new Proxy(client, {
    get(target, prop) {
      if (prop === 'core') return wrappedCore;
      const v = (target as unknown as Record<string, unknown>)[prop as string];
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  }) as ClientWithCoreApi;
}

/**
 * Wrap a `Reader` so every view rides through {@link withRetry} on the
 * **truncated-read** signature only — the one shape a {@link retryingClient}
 * cannot catch (it throws *after* a successful `simulateTransaction`, inside the
 * reader's own parse). Status is already handled by the proxied client beneath,
 * so the predicates stay disjoint and retries don't nest.
 */
export function retryingReader(reader: Reader, opts: RetryOptions = {}): Reader {
  const retry: RetryOptions = { ...opts, retryable: opts.retryable ?? isTruncatedRead };
  return new Proxy(reader, {
    get(target, prop) {
      const v = (target as unknown as Record<string, unknown>)[prop as string];
      if (typeof v !== 'function') return v;
      const fn = v as (...a: unknown[]) => unknown;
      return (...args: unknown[]) => withRetry(() => fn.apply(target, args) as Promise<unknown>, retry);
    },
  }) as Reader;
}

/**
 * Wrap a `SuiGraphQLClient` so discovery/history reads ride through
 * {@link withRetry} on transient status — both its `query` (raw GraphQL,
 * paginated and 429-prone) and its `core.*` reads (the internal `chainSource`
 * uses them). Idempotent reads only; same correctness boundary as the rest.
 */
export function retryingGraphqlClient(gql: SuiGraphQLClient, opts: RetryOptions = {}): SuiGraphQLClient {
  const retry: RetryOptions = { ...opts, retryable: opts.retryable ?? isTransientRequest };
  const coreWrapped = retryingClient(gql as unknown as ClientWithCoreApi, retry) as unknown as {
    core: unknown;
  };
  return new Proxy(gql, {
    get(target, prop) {
      if (prop === 'core') return coreWrapped.core;
      const v = (target as unknown as Record<string, unknown>)[prop as string];
      if (typeof v !== 'function') return v;
      const fn = v as (...a: unknown[]) => unknown;
      if (prop === 'query') {
        return (...args: unknown[]) => withRetry(() => fn.apply(target, args) as Promise<unknown>, retry);
      }
      return fn.bind(target); // bind others to the real client (private `this`)
    },
  }) as SuiGraphQLClient;
}
