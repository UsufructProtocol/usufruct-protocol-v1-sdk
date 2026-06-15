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
  it('maps the ensemble + retire commitment floors', () => {
    expect(() => mapAbort(new Error('… EEnsembleCommitmentFloorNotElapsed …'))).toThrow(CommittedEnsemble);
    expect(() => mapAbort(new Error('… ERetireCommitmentFloorNotElapsed …'))).toThrow(CommittedRetire);
  });
});
