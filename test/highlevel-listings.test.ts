import type { ClientWithCoreApi } from '@mysten/sui/client';
import { normalizeStructTag } from '@mysten/sui/utils';
import { describe, expect, it } from 'vitest';
import type { HandleCtx } from '@usufruct-protocol/sdk/highlevel/ctx.js';
import { UsufructError } from '@usufruct-protocol/sdk/highlevel/errors.js';
import { createListing } from '@usufruct-protocol/sdk/highlevel/listings.js';
import { usufruct } from '@usufruct-protocol/sdk/highlevel/usufruct.js';

const hex = (b: string) => '0x' + b.repeat(64);
const ctx: HandleCtx = {
  client: {} as ClientWithCoreApi,
  packageId: hex('a'),
  feeRefId: hex('b'),
  signer: null,
};

// An AssetIntegrated event payload as the indexer json delivers it — note the
// type strings arrive WITHOUT a `0x` prefix on the address.
const ASSET_T = 'a72e830fcb3e688ab3c20ff3cbd0a149cd1b58715709905585e75eb18317a52a::dummy_asset::DummyAsset';
const COIN_T = '97fb7c77162e3edf6a44815ec9eb29b69f9a43747dfb1c1019a7fc5501e2ad96::dummy_coin::DUMMY_COIN';
const JSON_EVENT = {
  escrow_id: hex('1'),
  asset_type: ASSET_T,
  coin_type: COIN_T,
  governance_cap_id: hex('2'),
  earnings_inbox_id: hex('3'),
  fee_inbox_id: hex('4'),
  governor_address: hex('5'),
};

describe('highlevel/listings — createListing maps AssetIntegrated json (decode-free)', () => {
  it('carries the identities and a back-edge', () => {
    const l = createListing(ctx, { json: JSON_EVENT, timestamp: '2026-06-15T12:00:00.000Z' });
    expect(l.escrowId).toBe(hex('1'));
    expect(l.governanceCapId).toBe(hex('2'));
    expect(l.earningsInboxId).toBe(hex('3'));
    expect(l.feeInboxId).toBe(hex('4'));
    expect(l.governor).toBe(hex('5'));
    expect(l.integratedAt).toEqual(new Date('2026-06-15T12:00:00.000Z'));
    expect(typeof l.escrow).toBe('function');
  });
  it('normalizes the type strings (prepends 0x, pads the address)', () => {
    const l = createListing(ctx, { json: JSON_EVENT, timestamp: null });
    expect(l.assetType).toBe(normalizeStructTag(`0x${ASSET_T}`));
    expect(l.coinType).toBe(normalizeStructTag(`0x${COIN_T}`));
    expect(l.assetType.startsWith('0x')).toBe(true);
    expect(l.integratedAt).toBeNull();
  });
});

describe('highlevel/discovery — needs the indexer (a graphql endpoint)', () => {
  it('escrowsIntegratedBy / escrowsByAssetType throw when discovery is disabled (graphql: false)', async () => {
    const u = usufruct({ client: {} as ClientWithCoreApi, graphql: false });
    await expect(u.inspect.integratedBy(hex('5'))).rejects.toBeInstanceOf(UsufructError);
    await expect(u.inspect.byAssetType(`0x${ASSET_T}`)).rejects.toBeInstanceOf(UsufructError);
  });
});
