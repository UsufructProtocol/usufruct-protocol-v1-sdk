/**
 * Offline golden replay (plan step 9): decode the chain-captured fixture and
 * assert every Pattern B view reproduces the answers the deployed Move
 * bytecode gave at capture time. Network-free CI gate; the prototype's
 * substitute for the Move-emitted fixture pipeline (SPEC §8.2).
 */
import { readFileSync } from 'node:fs';
import { bcs } from '@mysten/sui/bcs';
import { describe, expect, it } from 'vitest';
import { ms } from '../src/primitives/brand.js';
import { decodeEscrowState } from '../src/primitives/state.js';
import * as views from '../src/views/index.js';

interface Fixture {
  objectId: string;
  type: string;
  contentBase64: string;
  parity: {
    nowMs: string;
    onchain: {
      isIdle: boolean;
      isRented: boolean;
      isRetired: boolean;
      assetId: string;
      governanceCapId: string;
      activeAddr: string | null;
      phaseStartMs: string | null;
      tenureExpiryMs: string | null;
      transitionIsReady: boolean;
      nextTransitionMs: string | null;
    };
  };
}

const fixture: Fixture = JSON.parse(
  readFileSync(new URL('../fixtures/testnet-escrow-1.json', import.meta.url), 'utf8'),
);

const dummyAssetSchema = bcs.struct('DummyAsset', { id: bcs.Address, uses: bcs.u64() });

describe('golden replay of captured testnet escrow', () => {
  const state = decodeEscrowState(
    {
      objectId: fixture.objectId,
      type: fixture.type,
      content: Uint8Array.from(Buffer.from(fixture.contentBase64, 'base64')),
    },
    dummyAssetSchema,
  );
  const t = ms(fixture.parity.nowMs);
  const expected = fixture.parity.onchain;

  it('decodes the live escrow bytes', () => {
    expect(state.escrow.core).not.toBeNull();
    expect(state.escrow.state).not.toBeNull();
  });

  it('reproduces every recorded on-chain view answer', () => {
    expect(views.isIdle(state, t)).toBe(expected.isIdle);
    expect(views.isRented(state, t)).toBe(expected.isRented);
    expect(views.isRetired(state, t)).toBe(expected.isRetired);
    expect(views.assetId(state, t)).toBe(expected.assetId);
    expect(views.governanceCapId(state, t)).toBe(expected.governanceCapId);
    expect(views.activeUsufructuaryAddr(state, t)).toBe(expected.activeAddr);
    expect(String(views.phaseStartMs(state, t))).toBe(String(expected.phaseStartMs));
    expect(String(views.tenureExpiryMs(state, t))).toBe(String(expected.tenureExpiryMs));
    expect(views.transitionIsReady(state, t)).toBe(expected.transitionIsReady);
    expect(String(views.nextTransitionMs(state, t))).toBe(String(expected.nextTransitionMs));
  });
});
