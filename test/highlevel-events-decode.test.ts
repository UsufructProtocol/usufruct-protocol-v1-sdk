import { describe, expect, it } from 'vitest';
import { UsufructCapMinted } from '@usufruct-protocol/sdk/codegen/usufruct/usufruct_cap.js';
import { decodeEventBytes, typedEventFromBytes } from '@usufruct-protocol/sdk/indexer/events.js';

const hex = (b: string) => '0x' + b.repeat(64);
const ESCROW = hex('1');
const CAP = hex('2');
const USER = hex('3');

// The gRPC firehose hands us an event's `contents.value` as raw BCS bytes (not
// base64). These exercise that decode path — the same registry as History.
describe('indexer/events — typed events from raw BCS bytes (the gRPC path)', () => {
  it('typedEventFromBytes round-trips a registered event with its data + escrowId', () => {
    const bytes = UsufructCapMinted.serialize({
      escrow_id: ESCROW,
      usufruct_cap_id: CAP,
      usufructuary_address: USER,
    }).toBytes();

    const ev = typedEventFromBytes({
      type: `${hex('a')}::usufruct_cap::UsufructCapMinted`,
      sender: USER,
      timestamp: '2026-06-16T00:00:00.000Z',
      bytes,
    });

    expect(ev.module).toBe('usufruct_cap');
    expect(ev.name).toBe('UsufructCapMinted');
    expect(ev.sender).toBe(USER);
    expect(ev.escrowId).toBe(ESCROW); // extracted from the decoded payload, normalized
    expect(ev.data['usufruct_cap_id']).toBe(CAP);
    expect(ev.data['usufructuary_address']).toBe(USER);
  });

  it('decodeEventBytes returns null for an unregistered type (graceful fallback)', () => {
    expect(decodeEventBytes(`${hex('a')}::other_module::Whatever`, new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it('typedEventFromBytes with no bytes / unknown type yields empty data, null escrowId', () => {
    const ev = typedEventFromBytes({ type: `${hex('a')}::x::Y`, sender: null, timestamp: null, bytes: null });
    expect(ev.escrowId).toBeNull();
    expect(ev.data).toEqual({});
  });
});
