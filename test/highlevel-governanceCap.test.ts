import type { ClientWithCoreApi } from '@mysten/sui/client';
import { describe, expect, it } from 'vitest';
import type { HandleCtx } from '../src/highlevel/ctx.js';
import { CommittedEnsemble, CommittedRetire, InvalidEscalation, InvalidMarket, InvalidShape, NotConnected, mapAbort } from '../src/highlevel/errors.js';
import { createGovernanceCap } from '../src/highlevel/governanceCap.js';
import { createInbox } from '../src/highlevel/inbox.js';
import type { Market } from '../src/highlevel/market.js';
import { SUI } from '../src/highlevel/value.js';

const hex = (b: string) => '0x' + b.repeat(32);
const CAP = hex('11');
const INBOX = hex('22');
const ESCROW = hex('33');
const MARKET: Market = {
  restPrice: SUI(0.5),
  tenure: '1d',
  multiTenure: false,
  creditShape: 'linear',
  auctionShape: 'linear',
  descent: 'off',
  handover: 'off',
  escalation: { fixed: SUI(0) },
  retireCommitment: 'immediate',
  ensembleCommitment: 'immediate',
};

const readOnlyCtx: HandleCtx = {
  client: {} as ClientWithCoreApi,
  packageId: hex('aa'),
  feeRefId: hex('bb'),
  signer: null,
};

describe('highlevel/governanceCap — handle wiring (object, not role)', () => {
  it('exposes capId + the governance write surface + transfer (no earnings bundle)', () => {
    const g = createGovernanceCap(readOnlyCtx, CAP);
    expect(g.capId).toBe(CAP);
    for (const m of ['updateMarket', 'retire', 'claim', 'extendRetireCommitment', 'extendEnsembleCommitment', 'renounce', 'integrateIntoPortfolio', 'transfer'] as const) {
      expect(typeof g[m]).toBe('function');
    }
    // earnings are a SEPARATE object — not on the GovernanceCap.
    expect('earnings' in g).toBe(false);
  });

  it('writes need a signer (you must hold the cap)', async () => {
    const g = createGovernanceCap(readOnlyCtx, CAP);
    await expect(g.updateMarket(ESCROW, MARKET)).rejects.toBeInstanceOf(NotConnected);
    await expect(g.retire(ESCROW)).rejects.toBeInstanceOf(NotConnected);
    await expect(g.claim(ESCROW)).rejects.toBeInstanceOf(NotConnected);
    await expect(g.renounce()).rejects.toBeInstanceOf(NotConnected);
    await expect(g.transfer(hex('cc'))).rejects.toBeInstanceOf(NotConnected);
  });
});

describe('highlevel/inbox — earnings/fees inbox is its own object handle', () => {
  it('exposes inboxId + balance/collect/transfer', () => {
    const inbox = createInbox(readOnlyCtx, INBOX, 'earnings');
    expect(inbox.inboxId).toBe(INBOX);
    for (const m of ['balance', 'collect', 'transfer'] as const) {
      expect(typeof inbox[m]).toBe('function');
    }
  });
  it('collect / transfer need a signer (you must hold the inbox)', async () => {
    const inbox = createInbox(readOnlyCtx, INBOX, 'earnings');
    await expect(inbox.collect()).rejects.toBeInstanceOf(NotConnected);
    await expect(inbox.transfer(hex('cc'))).rejects.toBeInstanceOf(NotConnected);
  });
});

describe('highlevel/errors — commitment aborts map to typed errors', () => {
  const abort = (code: number, mod = 'asset_state') =>
    new Error(`MoveAbort in 1st command, abort code: ${code}, in '0xpkg::${mod}::guard' (instruction 9)`);
  it('maps the ensemble + retire commitment floors by (module, code)', () => {
    expect(() => mapAbort(abort(18))).toThrow(CommittedEnsemble);
    expect(() => mapAbort(abort(4))).toThrow(CommittedRetire);
  });
  it('maps the price-escalation EDeltaZero abort to InvalidEscalation', () => {
    expect(() => mapAbort(abort(0, 'price_escalation_policy'))).toThrow(InvalidEscalation);
  });
  it('maps curve-shape + field-policy aborts to typed errors', () => {
    expect(() => mapAbort(abort(2, 'curve_shape_policy'))).toThrow(InvalidShape); // num === den
    expect(() => mapAbort(abort(0, 'tenure_duration_policy'))).toThrow(InvalidMarket); // zero duration
    expect(() => mapAbort(abort(0, 'policy_ensemble'))).toThrow(InvalidMarket); // handover > tenure
  });
  it('rethrows an abort with an unmapped code', () => {
    const e = abort(99);
    expect(() => mapAbort(e)).toThrow(e);
  });
});
