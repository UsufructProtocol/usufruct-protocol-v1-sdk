/**
 * Offline test for `escrowVersionChangesMany` — the decode-free, multiplexed
 * version stream that the high-level portfolio watch (`u.watchMany`,
 * `governanceCap.watch`) is built on. A fake gRPC client yields canned
 * checkpoints over ONE `subscribeCheckpoints` stream; we assert the demux,
 * per-id dedupe, live add/remove, and clean close — no decode, no asset schema.
 */
import type { SuiGrpcClient } from '@mysten/sui/grpc';
import { describe, expect, it } from 'vitest';
import { id } from '@usufruct-protocol/sdk/primitives/brand.js';
import { escrowVersionChangesMany, type VersionUpdate } from '@usufruct-protocol/sdk/primitives/grpc-source.js';

const A = '0x' + 'ab'.repeat(32);
const B = '0x' + 'cd'.repeat(32);
const C = '0x' + 'ef'.repeat(32);
const OTHER = '0x' + 'ee'.repeat(32);

/** A checkpoint whose effects change the given objects to the given versions. */
const ck = (changed: { objectId: string; outputVersion: string }[]) => ({
  checkpoint: { transactions: [{ effects: { changedObjects: changed } }] },
});

const untilAbort = (signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    signal?.addEventListener('abort', () => resolve(), { once: true });
  });

/** Fake gRPC: per-id current version + a count of stream opens (multiplex proof). */
function fakeGrpc(makeStream: (chain: Record<string, string>, signal?: AbortSignal) => AsyncIterable<unknown>) {
  const chain: Record<string, string> = { [A]: '1', [B]: '1', [C]: '1' };
  let streamOpens = 0;
  const client = {
    core: {
      getObject: async ({ objectId }: { objectId: string }) => ({
        object: { objectId, version: chain[objectId] ?? '1' },
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

const collect = async (
  sub: AsyncIterable<VersionUpdate>,
  until: (seen: VersionUpdate[]) => boolean,
  done: () => void,
): Promise<VersionUpdate[]> => {
  const seen: VersionUpdate[] = [];
  for await (const u of sub) {
    seen.push(u);
    if (until(seen)) {
      done();
      break;
    }
  }
  return seen;
};

describe('escrowVersionChangesMany', () => {
  it('emits an initial per id, then one tagged update per real change — over ONE stream', async () => {
    const { client, streamOpens } = fakeGrpc(async function* (chain, signal) {
      yield ck([{ objectId: OTHER, outputVersion: '9' }]); // not watched → ignored
      chain[A] = '2';
      yield ck([{ objectId: A, outputVersion: '2' }]); // A → emit
      yield ck([{ objectId: A, outputVersion: '2' }]); // same version → dedupe
      chain[B] = '2';
      yield ck([{ objectId: B, outputVersion: '2' }]); // B → emit
      await untilAbort(signal);
    });

    const sub = escrowVersionChangesMany(client, [id<'Escrow'>(A), id<'Escrow'>(B)]);
    const seen = await collect(sub, (s) => s.length === 4, () => sub.close());

    // two initials (A@1, B@1) then A@2, B@2 — order of initials may interleave.
    const byId = (x: string) => seen.filter((u) => u.escrowId === x).map((u) => u.version);
    expect(byId(A)).toEqual(['1', '2']);
    expect(byId(B)).toEqual(['1', '2']);
    expect(streamOpens()).toBe(1); // ONE firehose for the whole set
  });

  it('add(id) starts watching live and emits its initial; remove(id) goes silent', async () => {
    const { client } = fakeGrpc(async function* (chain, signal) {
      // give the test room to add C before changes land
      await new Promise((r) => setTimeout(r, 20));
      chain[C] = '5';
      yield ck([{ objectId: C, outputVersion: '5' }]); // C (added late) → emit
      chain[A] = '2';
      yield ck([{ objectId: A, outputVersion: '2' }]); // A was removed → silent
      chain[B] = '2';
      yield ck([{ objectId: B, outputVersion: '2' }]); // B → emit (sentinel)
      await untilAbort(signal);
    });

    const sub = escrowVersionChangesMany(client, [id<'Escrow'>(A), id<'Escrow'>(B)]);
    const seen: VersionUpdate[] = [];
    const ac = { stop: false };
    const loop = (async () => {
      for await (const u of sub) {
        seen.push(u);
        if (ac.stop) break;
      }
    })();

    await sub.add(id<'Escrow'>(C)); // initial C@1
    sub.remove(id<'Escrow'>(A)); // A changes will now be ignored
    await new Promise((r) => setTimeout(r, 120));
    ac.stop = true;
    sub.close();
    await loop;

    const versions = (x: string) => seen.filter((u) => u.escrowId === x).map((u) => u.version);
    expect(versions(C)).toContain('1'); // C's initial after add
    expect(versions(C)).toContain('5'); // C's change
    expect(versions(B)).toContain('2'); // B still watched
    expect(versions(A)).toEqual(['1']); // only A's initial — removed before its change
  });

  it('close() ends the iteration cleanly', async () => {
    const { client } = fakeGrpc(async function* (_chain, signal) {
      await untilAbort(signal);
    });
    const sub = escrowVersionChangesMany(client, [id<'Escrow'>(A)]);
    const seen: VersionUpdate[] = [];
    const loop = (async () => {
      for await (const u of sub) seen.push(u);
    })();
    await new Promise((r) => setTimeout(r, 20));
    sub.close();
    await loop; // resolves — iteration ended
    expect(seen.map((u) => u.escrowId)).toEqual([A]); // just the initial
  });
});
