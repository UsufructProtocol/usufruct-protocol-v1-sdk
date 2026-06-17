/**
 * e2e harness plumbing: signer loading, transaction execution, id
 * extraction. Testnet only.
 */
import { execFileSync } from 'node:child_process';
import { bcs } from '@mysten/sui/bcs';
import type { ClientWithCoreApi, SuiClientTypes } from '@mysten/sui/client';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import type { Transaction } from '@mysten/sui/transactions';
import { resolveFeeInboxId } from '@usufruct-protocol/sdk/highlevel/feeref.js';

export const RPC_URL = 'https://fullnode.testnet.sui.io:443';

export function makeClient(): ClientWithCoreApi {
  if (process.env['E2E_TRANSPORT'] === 'grpc') {
    return new SuiGrpcClient({ network: 'testnet', baseUrl: RPC_URL });
  }
  return new SuiJsonRpcClient({ network: 'testnet', url: RPC_URL });
}

/** A gRPC client — required for `grpcSource` push (subscriptionService). */
export function makeGrpcClient(): SuiGrpcClient {
  return new SuiGrpcClient({ network: 'testnet', baseUrl: RPC_URL });
}

/**
 * Signer: `SUI_PRIVATE_KEY` (bech32 `suiprivkey…`) or exported from the
 * local Sui CLI keystore via `sui keytool export` for the given alias.
 */
export function loadSigner(alias = 'usufruct-sdk-testnet'): Ed25519Keypair {
  const env = process.env['SUI_PRIVATE_KEY'];
  if (env) return Ed25519Keypair.fromSecretKey(env.trim());
  const out = execFileSync(
    'sui',
    ['keytool', 'export', '--key-identity', alias, '--json'],
    { encoding: 'utf8' },
  );
  const json = JSON.parse(out.slice(out.indexOf('{')));
  const key: string | undefined = json.exportedPrivateKey;
  if (!key?.startsWith('suiprivkey')) {
    throw new Error(`could not export key for alias ${alias}`);
  }
  return Ed25519Keypair.fromSecretKey(key);
}

/**
 * The signer that owns the protocol-fee inbox — the authority to collect fees
 * (the collect fn has no cap; ownership IS the authority). Derived on-chain from
 * the deployment's `feeRefId` → inbox id → its `AddressOwner`, then loaded by that
 * address (`sui keytool` accepts an address as `--key-identity`). No hardcoded
 * alias, so it self-adjusts to any redeploy. `FEE_OWNER_ALIAS` env overrides.
 */
export async function loadFeeOwner(client: ClientWithCoreApi, feeRefId: string): Promise<Ed25519Keypair> {
  const override = process.env['FEE_OWNER_ALIAS'];
  if (override) return loadSigner(override);
  const inboxId = await resolveFeeInboxId(client, feeRefId);
  const { object } = await client.core.getObject({ objectId: inboxId });
  if (object.owner?.$kind !== 'AddressOwner') {
    throw new Error(`fee inbox ${inboxId} is not address-owned (${object.owner?.$kind})`);
  }
  return loadSigner(object.owner.AddressOwner);
}

export type ExecResult = SuiClientTypes.Transaction<{
  effects: true;
  events: true;
  objectTypes: true;
  balanceChanges: true;
}>;

export async function send(
  client: ClientWithCoreApi,
  tx: Transaction,
  signer: Ed25519Keypair,
): Promise<ExecResult> {
  tx.setSenderIfNotSet(signer.toSuiAddress());
  const result = await retry429(() =>
    client.core.signAndExecuteTransaction({
      transaction: tx,
      signer,
      include: { effects: true, events: true, objectTypes: true, balanceChanges: true },
    }),
  );
  if (result.$kind !== 'Transaction') {
    const failed = result.FailedTransaction;
    throw new Error(
      `tx failed: ${JSON.stringify(failed?.status.error)} digest=${failed?.digest}`,
    );
  }
  const res = result.Transaction;
  await client.core.waitForTransaction({ digest: res.digest });
  if (!res.status.success) {
    throw new Error(`tx failed: ${JSON.stringify(res.status.error)} digest=${res.digest}`);
  }
  return res;
}

/** Id of the created object whose type contains `frag`. */
export function createdId(res: ExecResult, frag: string): string {
  for (const ch of res.effects?.changedObjects ?? []) {
    if (ch.idOperation !== 'Created') continue;
    const type = res.objectTypes?.[ch.objectId];
    if (type?.includes(frag)) return ch.objectId;
  }
  throw new Error(`no created object matching ${frag}`);
}

// ── PASS/FAIL reporting ──
let failures = 0;

export function check(name: string, cond: boolean, detail = ''): void {
  const tag = cond ? 'PASS' : 'FAIL';
  if (!cond) failures += 1;
  console.log(`  [${tag}] ${name}${detail ? ` — ${detail}` : ''}`);
}

export function step(title: string): void {
  console.log(`\n== ${title}`);
}

export function finish(): never {
  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

export const sleep = (msec: number) => new Promise((r) => setTimeout(r, msec));

/**
 * Wrap a client so every async `core.*` call rides through `retry429` — used
 * by the e2e against the public fullnode (the Reader/Source do their own raw
 * reads). The kernel never bakes in retries; this is harness resilience only.
 */
export function rateLimited(client: ClientWithCoreApi): ClientWithCoreApi {
  const core = client.core as unknown as Record<string, unknown>;
  const wrappedCore = new Proxy(core, {
    get(target, prop) {
      const v = target[prop as string];
      if (typeof v !== 'function') return v;
      const fn = v as (...a: unknown[]) => unknown;
      return (...args: unknown[]) => retry429(async () => fn.apply(target, args) as Promise<unknown>);
    },
  });
  return new Proxy(client, {
    get(target, prop) {
      if (prop === 'core') return wrappedCore;
      return (target as unknown as Record<string, unknown>)[prop as string];
    },
  }) as ClientWithCoreApi;
}

/** Retry on transient public-fullnode errors (429/502/503) with backoff. */
export async function retry429<T>(fn: () => Promise<T>, attempts = 6): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (![429, 502, 503].includes(status ?? 0) || i >= attempts - 1) throw e;
      const backoff = 2_000 * 2 ** i;
      console.log(`  [${status}] transient fullnode error — backing off ${backoff}ms`);
      await sleep(backoff);
    }
  }
}

/**
 * The chain's own clock (`0x6`), not the local clock — local skew (observed
 * ~15s on this machine) breaks boundary waits otherwise.
 */
export async function chainNowMs(client: ClientWithCoreApi): Promise<bigint> {
  const { object } = await client.core.getObject({
    objectId: '0x6',
    include: { content: true },
  });
  const clock = bcs
    .struct('Clock', { id: bcs.Address, timestamp_ms: bcs.u64() })
    .parse(object.content!);
  return BigInt(clock.timestamp_ms);
}

/** Sleep until the on-chain clock passes `boundaryMs` (+ margin). */
export async function waitForChainTime(
  client: ClientWithCoreApi,
  boundaryMs: bigint,
  marginMs = 1_000n,
): Promise<bigint> {
  for (;;) {
    const now = await chainNowMs(client);
    if (now >= boundaryMs + marginMs) return now;
    const remaining = Number(boundaryMs + marginMs - now);
    await sleep(Math.min(Math.max(remaining, 500), 5_000));
  }
}
