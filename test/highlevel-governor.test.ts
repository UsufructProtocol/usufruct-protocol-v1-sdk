import type { ClientWithCoreApi } from '@mysten/sui/client';
import { describe, expect, it } from 'vitest';
import type { HandleCtx } from '../src/highlevel/ctx.js';
import { CommittedEnsemble, CommittedRetire, NotConnected, mapAbort } from '../src/highlevel/errors.js';
import { createGovernor } from '../src/highlevel/governor.js';
import type { Market } from '../src/highlevel/market.js';
import { SUI } from '../src/highlevel/value.js';
import type { Source } from '../src/primitives/source.js';

const hex = (b: string) => '0x' + b.repeat(32);
const CAP = hex('11');
const INBOX = hex('22');
const ESCROW = hex('33');
const MARKET: Market = { restPrice: SUI(0.5), tenure: '1d', coin: SUI };

const readOnlyCtx: HandleCtx = {
  client: {} as ClientWithCoreApi,
  packageId: hex('aa'),
  feeRefId: hex('bb'),
  source: {} as unknown as Source,
  signer: null,
};

describe('highlevel/governor — handle wiring', () => {
  it('exposes capId + earnings inbox + the write surface', () => {
    const g = createGovernor(readOnlyCtx, { capId: CAP, inboxId: INBOX });
    expect(g.capId).toBe(CAP);
    expect(g.earnings.inboxId).toBe(INBOX);
    for (const m of ['update', 'retire', 'claim', 'extendRetireCommitment', 'extendEnsembleCommitment', 'renounce', 'list', 'escrows'] as const) {
      expect(typeof g[m]).toBe('function');
    }
  });
});

describe('highlevel/governor — needs a signer for writes', () => {
  const g = createGovernor(readOnlyCtx, { capId: CAP, inboxId: INBOX });
  it('update / retire / claim / renounce / earnings.collect reject NotConnected', async () => {
    await expect(g.update(ESCROW, MARKET)).rejects.toBeInstanceOf(NotConnected);
    await expect(g.retire(ESCROW)).rejects.toBeInstanceOf(NotConnected);
    await expect(g.claim(ESCROW)).rejects.toBeInstanceOf(NotConnected);
    await expect(g.renounce()).rejects.toBeInstanceOf(NotConnected);
    await expect(g.earnings.collect()).rejects.toBeInstanceOf(NotConnected);
  });
});

describe('highlevel/errors — commitment aborts map to typed errors', () => {
  // Runtime aborts carry (code, module), not the Move constant name.
  const abort = (code: number, mod = 'asset_state') =>
    new Error(`MoveAbort in 1st command, abort code: ${code}, in '0xpkg::${mod}::guard' (instruction 9)`);
  it('maps the ensemble + retire commitment floors by (module, code)', () => {
    expect(() => mapAbort(abort(18))).toThrow(CommittedEnsemble);
    expect(() => mapAbort(abort(4))).toThrow(CommittedRetire);
  });
  it('rethrows an abort with an unmapped code', () => {
    const e = abort(99);
    expect(() => mapAbort(e)).toThrow(e);
  });
});
