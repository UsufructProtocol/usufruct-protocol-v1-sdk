import { describe, expect, it } from 'vitest';
import { createInbox } from '@usufruct-protocol/sdk/highlevel/inbox.js';
import { createGovernanceCap } from '@usufruct-protocol/sdk/highlevel/governanceCap.js';
import type { HandleCtx } from '@usufruct-protocol/sdk/highlevel/ctx.js';

const PKG = '0x2';
const INBOX = '0x' + '22'.repeat(32);
const OTHER_INBOX = '0x' + '99'.repeat(32);
const GOVCAP = '0x' + '33'.repeat(32);
const A = '0x' + 'aa'.repeat(32);
const B = '0x' + 'bb'.repeat(32);
const FOREIGN = '0x' + 'ff'.repeat(32);
const DUMMY_T = '0x97fb7c77162e3edf6a44815ec9eb29b69f9a43747dfb1c1019a7fc5501e2ad96::dummy_coin::DUMMY_COIN';
const USDC_T = '0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC';

interface FakeEvent {
  type: string;
  json?: Record<string, unknown>;
  data?: Record<string, unknown>;
  escrowId?: string | null;
  timestamp?: string | null;
}

/** A HandleCtx whose indexer replays `events`, dispatched by the queried type. */
function makeCtx(events: FakeEvent[]): HandleCtx {
  return {
    client: { core: { getCoinMetadata: async () => null } }, // resolveCoinInfo → 9-dec fallback
    packageId: PKG,
    feeRefId: '0x0',
    account: null,
    defaultExecutor: null,
    indexer: {
      // eslint-disable-next-line require-yield
      async *events(filter: { type: string }) {
        for (const e of events) if (e.type === filter.type) yield e;
      },
    },
  } as unknown as HandleCtx;
}

const integrated = (escrowId: string, coin: string): FakeEvent => ({
  type: `${PKG}::asset_state::AssetIntegrated`,
  json: {
    escrow_id: escrowId, asset_type: '0xa::d::A', coin_type: coin,
    governance_cap_id: GOVCAP, earnings_inbox_id: INBOX, fee_inbox_id: '0x0', governor_address: '0x1',
  },
  timestamp: null,
});
const posted = (escrowId: string, inbox: string, coin: string, amount: string): FakeEvent => ({
  type: `${PKG}::earnings_message::EarningsMessagePosted`,
  data: { earnings_inbox_id: inbox, escrow_id: escrowId, coin_type: coin, amount },
  escrowId,
  timestamp: null,
});

describe('inbox.history / totals — filter by inbox, sum per coin', () => {
  const ctx = makeCtx([
    posted(A, INBOX, DUMMY_T, '450000000'),
    posted(B, INBOX, USDC_T, '450000'),
    posted(FOREIGN, OTHER_INBOX, DUMMY_T, '999'), // a different inbox — must be excluded
  ]);
  const inbox = createInbox(ctx, INBOX, 'earnings');

  it('history keeps only this inbox’s messages', async () => {
    const log = await inbox.inspect.history();
    expect(log).toHaveLength(2);
    expect(log.map((m) => m.amount.mist).sort()).toEqual([450000n, 450000000n]);
  });

  it('totals sums per coin (a separate entry per coin type)', async () => {
    const totals = await inbox.inspect.totals();
    expect(totals).toHaveLength(2);
    const dummy = totals.find((t) => t.coin.includes('dummy_coin'));
    const usdc = totals.find((t) => t.coin.includes('usdc'));
    expect(dummy?.total.mist).toBe(450000000n);
    expect(dummy?.count).toBe(1);
    expect(usdc?.total.mist).toBe(450000n);
  });
});

describe('governanceCap.revenueByEscrow — attribute earnings to the cap’s escrows', () => {
  const ctx = makeCtx([
    integrated(A, DUMMY_T),
    integrated(B, USDC_T),
    posted(A, INBOX, DUMMY_T, '450000000'),
    posted(B, INBOX, USDC_T, '450000'),
    posted(FOREIGN, INBOX, DUMMY_T, '777'), // not in this cap’s portfolio — must be excluded
  ]);
  const cap = createGovernanceCap(ctx, GOVCAP);

  it('groups revenue per escrow, only for the portfolio', async () => {
    const rev = await cap.inspect.revenueByEscrow();
    expect(rev).toHaveLength(2);
    const byId = new Map(rev.map((r) => [r.escrowId.replace(/^0x/, '').toLowerCase(), r]));
    const a = byId.get('aa'.repeat(32));
    const b = byId.get('bb'.repeat(32));
    expect(a?.earnings[0]!.total.mist).toBe(450000000n);
    expect(b?.earnings[0]!.total.mist).toBe(450000n);
    // the foreign escrow’s 777 is not attributed to this cap
    expect(rev.some((r) => r.earnings.some((e) => e.total.mist === 777n))).toBe(false);
  });
});
