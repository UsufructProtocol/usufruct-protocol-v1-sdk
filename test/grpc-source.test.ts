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

const ESCROW_B = '0x' + 'cd'.repeat(32);

/**
 * Like `fakeGrpc`, but tracks a *per-id* chain version (so subscribeMany can
 * dedupe each escrow independently) and counts `subscribeCheckpoints` opens
 * (the multiplex proof: one stream for all ids).
 */
function fakeGrpcMany(
  makeStream: (chain: Record<string, string>, signal?: AbortSignal) => AsyncIterable<unknown>,
) {
  const chain: Record<string, string> = { [ESCROW]: '1', [ESCROW_B]: '1' };
  let streamOpens = 0;
  const client = {
    core: {
      getObject: async ({ objectId }: { objectId: string }) => ({
        object: { objectId, version: chain[objectId] ?? '1', digest: 'd', type: ESCROW_TYPE, content: escrowBytes() },
      }),
    },
    subscriptionService: {
      subscribeCheckpoints: (_req: unknown, opts?: { abort?: AbortSignal }) => {
        streamOpens += 1;
        return { responses: makeStream(chain, opts?.abort) };
      },
    },
  } as unknown as SuiGrpcClient;
  return { client, streamOpens: () => streamOpens };
}

describe('grpcSource.subscribeMany', () => {
  it('demuxes one firehose to per-id tagged emissions', async () => {
    const { client, streamOpens } = fakeGrpcMany(async function* (chain, signal) {
      yield ck([{ objectId: OTHER, outputVersion: '9' }]); // not subscribed → no emit
      chain[ESCROW] = '2';
      yield ck([{ objectId: ESCROW, outputVersion: '2' }]); // → {A}
      yield ck([{ objectId: ESCROW, outputVersion: '2' }]); // same version → dedupe
      chain[ESCROW_B] = '2';
      yield ck([{ objectId: ESCROW_B, outputVersion: '2' }]); // → {B}
      chain[ESCROW] = '3';
      chain[ESCROW_B] = '3';
      yield ck([
        { objectId: ESCROW, outputVersion: '3' },
        { objectId: ESCROW_B, outputVersion: '3' },
      ]); // one checkpoint, both changed → {A} and {B}
      await untilAbort(signal);
    });

    const ac = new AbortController();
    const tags: string[] = [];
    for await (const u of grpcSource(client).subscribeMany(
      [id<'Escrow'>(ESCROW), id<'Escrow'>(ESCROW_B)],
      { signal: ac.signal },
    )) {
      tags.push(u.escrowId);
      if (tags.length === 6) ac.abort(); // initial A,B + A + B + A + B
    }

    // Two initial emissions (one per id), then routed updates; dup deduped.
    expect(tags.slice(0, 2).sort()).toEqual([ESCROW, ESCROW_B].sort());
    expect(tags.filter((t) => t === ESCROW)).toHaveLength(3); // initial + v2 + v3
    expect(tags.filter((t) => t === ESCROW_B)).toHaveLength(3); // initial + v2 + v3
    expect(streamOpens()).toBe(1); // one firehose for both escrows
  });

  it('stops cleanly on abort after the initial emissions', async () => {
    const { client } = fakeGrpcMany(async function* (_chain, signal) {
      await untilAbort(signal);
    });
    const ac = new AbortController();
    const tags: string[] = [];
    for await (const u of grpcSource(client).subscribeMany(
      [id<'Escrow'>(ESCROW), id<'Escrow'>(ESCROW_B)],
      { signal: ac.signal },
    )) {
      tags.push(u.escrowId);
      if (tags.length === 2) ac.abort(); // both initials in, then close
    }
    expect(tags.sort()).toEqual([ESCROW, ESCROW_B].sort());
  });
});
