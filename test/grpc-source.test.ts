/**
 * Offline grpcSource.subscribe: server-push over a fake checkpoint stream.
 * The fake SuiGrpcClient exposes subscriptionService.subscribeCheckpoints
 * (an async-iterable of canned checkpoints) + core.getObject (codegen bytes
 * at the current chain version). Asserts: initial state, emit only on a
 * checkpoint that changes our escrow to a new version, dedupe by version,
 * skip checkpoints that don't touch us, and clean abort.
 */
import type { SuiGrpcClient } from '@mysten/sui/grpc';
import { describe, expect, it } from 'vitest';
import { Escrow } from '../src/codegen/usufruct/escrow.js';
import { id } from '../src/primitives/brand.js';
import { grpcSource } from '../src/primitives/grpc-source.js';
import { uidAssetSchema } from '../src/primitives/state.js';
import { ASSET_ID, defaultCore, defaultCycle } from './synthetic.js';

const PKG = '0x' + '0a'.repeat(32);
const ESCROW = '0x' + 'ab'.repeat(32);
const OTHER = '0x' + 'ee'.repeat(32);
const ESCROW_TYPE = `${PKG}::escrow::Escrow<0xa::dummy::DummyAsset, 0x2::sui::SUI>`;

function escrowBytes(): Uint8Array {
  return Escrow(uidAssetSchema)
    .serialize({
      id: ESCROW,
      core: defaultCore,
      state: { Waiting: { Idle: { asset: { asset: { id: ASSET_ID } }, cycle: defaultCycle } } },
    })
    .toBytes();
}

/** A checkpoint whose effects change the given objects to the given versions. */
const ck = (changed: { objectId: string; outputVersion: string }[]) => ({
  checkpoint: { transactions: [{ effects: { changedObjects: changed } }] },
});

/**
 * Fake client: `getObject` returns the escrow at the *current* chain version
 * (a shared mutable the stream advances), so a re-fetch after a change sees
 * the new version. `subscribeCheckpoints` yields canned checkpoints, then
 * stays open until aborted (a firehose never "completes").
 */
function fakeGrpc(makeStream: (chain: { version: string }, signal?: AbortSignal) => AsyncIterable<unknown>) {
  const chain = { version: '1' };
  let getCalls = 0;
  const client = {
    core: {
      getObject: async ({ objectId }: { objectId: string }) => {
        getCalls += 1;
        return {
          object: { objectId, version: chain.version, digest: 'd', type: ESCROW_TYPE, content: escrowBytes() },
        };
      },
    },
    subscriptionService: {
      subscribeCheckpoints: (_req: unknown, opts?: { abort?: AbortSignal }) => ({
        responses: makeStream(chain, opts?.abort),
      }),
    },
  } as unknown as SuiGrpcClient;
  return { client, getCalls: () => getCalls };
}

/** Resolves when the signal aborts — keeps the firehose open like the real one. */
const untilAbort = (signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    signal?.addEventListener('abort', () => resolve(), { once: true });
  });

describe('grpcSource.subscribe', () => {
  it('emits initial state, then only on a checkpoint that changes our escrow', async () => {
    const { client } = fakeGrpc(async function* (chain, signal) {
      yield ck([{ objectId: OTHER, outputVersion: '7' }]); // not us → no emit
      chain.version = '2';
      yield ck([{ objectId: ESCROW, outputVersion: '2' }]); // us → emit v2
      yield ck([{ objectId: ESCROW, outputVersion: '2' }]); // same version → dedupe
      chain.version = '3';
      yield ck([{ objectId: ESCROW, outputVersion: '3' }]); // us → emit v3
      await untilAbort(signal);
    });

    const ac = new AbortController();
    const seen: string[] = [];
    for await (const s of grpcSource(client).subscribe(id<'Escrow'>(ESCROW), { signal: ac.signal })) {
      seen.push(s.objectId);
      if (seen.length === 3) ac.abort(); // initial(v1) + v2 + v3
    }
    expect(seen).toEqual([ESCROW, ESCROW, ESCROW]); // 3 emissions, dup deduped
  });

  it('stops cleanly when already aborted before the first checkpoint', async () => {
    const { client, getCalls } = fakeGrpc(async function* (_chain, signal) {
      await untilAbort(signal);
    });
    const ac = new AbortController();
    const src = grpcSource(client).subscribe(id<'Escrow'>(ESCROW), { signal: ac.signal });
    // The initial fetch still yields once; abort right after.
    const seen: string[] = [];
    for await (const s of src) {
      seen.push(s.objectId);
      ac.abort();
    }
    expect(seen).toEqual([ESCROW]); // initial state, then the stream is abort-closed
    expect(getCalls()).toBe(1); // only the initial fetch — no checkpoint hit
  });
});
