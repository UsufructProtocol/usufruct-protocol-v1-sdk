import { readFileSync } from 'node:fs';
import { bcs } from '@mysten/sui/bcs';
import { describe, expect, it } from 'vitest';
import { Escrow } from '@usufruct-protocol/sdk/codegen/usufruct/escrow.js';
import { escrowTypeArgs, uidAssetSchema } from '@usufruct-protocol/sdk/primitives/state.js';
import {
  EscrowDecodeError,
  decodeEscrowState,
} from '@usufruct-protocol/sim/primitives/state.js';

const ESCROW_ID = '0x' + 'ab'.repeat(32);
const ASSET_ID = '0x' + 'cd'.repeat(32);
const GOVERNOR = '0x' + '11'.repeat(32);
const INBOX_ID = '0x' + '22'.repeat(32);
const CAP_ID = '0x' + '33'.repeat(32);
const FEE_INBOX = '0x' + '44'.repeat(32);

/** Minimal idle escrow encoded with the codegen schema itself. */
function encodeIdleEscrow(): Uint8Array {
  const ensemble = {
    rest_price: { Fixed: { price: { mist: 1000n } } },
    tenure_duration: { Fixed: { ceiling: { ms: 60_000n } } },
    tenure_extend: { Single: true },
    handover: { Off: true },
    auction_window: { Off: true },
    credit_shape: { Linear: true },
    auction_shape: { Linear: true },
    price_escalation: { FixedDelta: { delta: { mist: 1n } } },
  };
  return Escrow(uidAssetSchema)
    .serialize({
      id: ESCROW_ID,
      core: {
        governor_seat: {
          identity: { cap_identity: { id: CAP_ID } },
          inbox: { id: INBOX_ID },
        },
        ensemble: { active: ensemble, pending: null },
        fee_inbox_identity: { id: FEE_INBOX },
        integrated_at: { ms: 1_000n },
        retire_commitment: { policy: { Immediate: true }, anchor: { ms: 1_000n } },
        ensemble_commitment: { policy: { Immediate: true }, anchor: { ms: 1_000n } },
        escrow_identity: { id: ESCROW_ID },
      },
      state: {
        Waiting: {
          Idle: {
            asset: { asset: { id: ASSET_ID } },
            cycle: {
              floor: { mist: 1000n },
              ceiling: { ms: 60_000n },
              handover: { ms: 0n },
              descent: { ms: 0n },
            },
          },
        },
      },
    })
    .toBytes();
}

describe('EscrowState', () => {
  it('splits nested generic type args', () => {
    expect(
      escrowTypeArgs('0x1::escrow::Escrow<0x2::a::A<0x3::b::B, 0x4::c::C>, 0x2::sui::SUI>'),
    ).toEqual(['0x2::a::A<0x3::b::B, 0x4::c::C>', '0x2::sui::SUI']);
  });

  it('decodes a hand-encoded escrow and exposes plain data', () => {
    const state = decodeEscrowState({
      objectId: ESCROW_ID,
      type: `0xpkg::escrow::Escrow<0xa::dummy::DummyAsset, 0x2::sui::SUI>`,
      content: encodeIdleEscrow(),
    });

    expect(state.assetType).toBe('0xa::dummy::DummyAsset');
    expect(state.coinType).toBe('0x2::sui::SUI');
    expect(state.escrow.core?.integrated_at.ms).toBe('1000');
    expect(state.escrow.state?.$kind).toBe('Waiting');
    expect(state.escrow.state?.Waiting?.$kind).toBe('Idle');

    // State is data: the type rejects mutation.
    // @ts-expect-error — EscrowState fields are readonly
    state.assetType = 'nope';
  });

  it('decode invariant: a wrong asset schema throws instead of misaligning', () => {
    // Real chain-captured escrow whose asset is DummyAsset { id, uses } —
    // before the invariant, decoding it as uid-only silently shifted every
    // field after the asset by 8 bytes (observed live on testnet).
    const fixture = JSON.parse(
      readFileSync(new URL('../fixtures/testnet-escrow-1.json', import.meta.url), 'utf8'),
    );
    const snapshot = {
      objectId: fixture.objectId,
      type: fixture.type,
      content: Uint8Array.from(Buffer.from(fixture.contentBase64, 'base64')),
    };

    expect(() => decodeEscrowState(snapshot, uidAssetSchema)).toThrow(EscrowDecodeError);

    const correct = bcs.struct('DummyAsset', { id: bcs.Address, uses: bcs.u64() });
    expect(() => decodeEscrowState(snapshot, correct)).not.toThrow();
  });
});
