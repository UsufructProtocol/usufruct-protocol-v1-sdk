/**
 * Offline MemorySource: the whole lifecycle in RAM (no network) — apply
 * Action.step into the store and read it back through the same views the live
 * SDK uses; discovery by the predicates EscrowState can answer; event-driven
 * subscribe.
 */
import { describe, expect, it } from 'vitest';
import * as actions from '../src/actions/index.js';
import { id, mist, ms, tenureCount } from '../src/primitives/brand.js';
import { memorySource } from '../src/primitives/memory-source.js';
import { isMissingObject } from '../src/primitives/source.js';
import * as views from '../src/views/index.js';
import { ESCROW_ID, TENANT, idleState, occupiedState, retiredState } from './synthetic.js';

const escrowId = id<'Escrow'>(ESCROW_ID);
const B_ID = id<'Escrow'>('0x' + 'b2'.repeat(32));
const C_ID = id<'Escrow'>('0x' + 'c3'.repeat(32));

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of it) out.push(v);
  return out;
}

async function until(pred: () => boolean, msMax = 1000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > msMax) throw new Error('until: timeout');
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('memorySource store', () => {
  it('fetch / set / delete / has / size; missing fetch is recognizable', async () => {
    const mem = memorySource([idleState()]);
    expect(mem.size).toBe(1);
    expect(mem.has(escrowId)).toBe(true);
    expect(await mem.fetch(escrowId)).toEqual(idleState());

    mem.delete(escrowId);
    expect(mem.has(escrowId)).toBe(false);
    await expect(mem.fetch(escrowId)).rejects.toThrow();
    const err = await mem.fetch(escrowId).catch((e) => e);
    expect(isMissingObject(err)).toBe(true);
  });
});

describe('memorySource apply (Action.step into the store)', () => {
  it('applyOrigin(integrate) seeds an Idle state', async () => {
    const mem = memorySource();
    const integrate = actions.integrate({
      ensemble: { restPrice: mist(1_000), tenureMs: ms(60_000) },
      assetType: '0xa::dummy::DummyAsset',
      coinType: '0x2::sui::SUI',
    });
    const { state } = mem.applyOrigin(integrate, ms(5_000));
    expect(views.isIdle(state, ms(5_000))).toBe(true);
    expect(mem.has(state.objectId)).toBe(true);
    expect(await mem.fetch(state.objectId)).toEqual(state);
  });

  it('apply(rent) transitions Idle → Occupied', async () => {
    const mem = memorySource([idleState()]);
    expect(views.isOccupied(await mem.fetch(escrowId), ms(1_000))).toBe(false);

    const result = mem.apply(
      escrowId,
      actions.rent({ tenures: tenureCount(1), paymentMist: mist(1_000), sender: TENANT }),
      ms(1_000),
    );
    expect(result.transition).toBe('install');
    expect(views.isOccupied(await mem.fetch(escrowId), ms(1_000))).toBe(true);
  });

  it('applyTerminal(claimAsset) returns the asset and consumes the escrow', () => {
    const mem = memorySource([retiredState()]);
    const result = mem.applyTerminal(escrowId, actions.claimAsset(), ms(1_000));
    expect(result.assetId).toBeTruthy();
    expect(mem.has(escrowId)).toBe(false); // terminal consumes it
  });
});

describe('memorySource query', () => {
  const occ = { ...occupiedState(10_000n), objectId: C_ID }; // TENANT active
  const other = { ...idleState(), objectId: B_ID, assetType: '0xb::other::OtherAsset' };
  const mem = memorySource([idleState(), other, occ]);

  it('all yields every stored escrow', async () => {
    const ids = (await collect(mem.query({ all: true }))).map((s) => s.objectId);
    expect(ids.sort()).toEqual([escrowId, B_ID, C_ID].sort());
  });

  it('byAssetType filters by decoded asset type', async () => {
    const ids = (await collect(mem.query({ byAssetType: '0xa::dummy::DummyAsset' }))).map((s) => s.objectId);
    expect(ids).toContain(escrowId);
    expect(ids).toContain(C_ID);
    expect(ids).not.toContain(B_ID); // OtherAsset
  });

  it('byUsufructuary matches the active tenant', async () => {
    const ids = (await collect(mem.query({ byUsufructuary: TENANT }))).map((s) => s.objectId);
    expect(ids).toEqual([C_ID]); // only the occupied escrow has an active tenant
  });

  it('byGovernor filters by the seed-time governor tag', async () => {
    const GOV1 = '0x' + 'd4'.repeat(32);
    const GOV2 = '0x' + 'd5'.repeat(32);
    const tagged = memorySource([
      { state: idleState(), governor: GOV1 }, // escrowId
      { state: { ...idleState(), objectId: B_ID }, governor: GOV2 },
      { state: { ...idleState(), objectId: C_ID }, governor: GOV1 },
    ]);
    const ids = (await collect(tagged.query({ byGovernor: GOV1 }))).map((s) => s.objectId);
    expect(ids.sort()).toEqual([escrowId, C_ID].sort()); // GOV2's B excluded
    // An untagged store yields nothing for byGovernor (no false matches).
    const untagged = memorySource([idleState()]);
    expect(await collect(untagged.query({ byGovernor: GOV1 }))).toEqual([]);
  });
});

describe('memorySource subscribe', () => {
  it('emits the initial state, then on each change; aborts cleanly', async () => {
    const mem = memorySource([idleState()]);
    const ac = new AbortController();
    const occupied: boolean[] = [];
    const run = (async () => {
      for await (const s of mem.subscribe(escrowId, { signal: ac.signal })) {
        occupied.push(views.isOccupied(s, ms(1_000)));
        if (occupied.length === 2) ac.abort();
      }
    })();

    await until(() => occupied.length === 1); // initial (Idle)
    mem.apply(
      escrowId,
      actions.rent({ tenures: tenureCount(1), paymentMist: mist(1_000), sender: TENANT }),
      ms(1_000),
    );
    await run;
    expect(occupied).toEqual([false, true]); // Idle initial, then Occupied
  });
});
