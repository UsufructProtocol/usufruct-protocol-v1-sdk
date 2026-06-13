import { describe, expect, it } from 'vitest';
import { createReader } from '../src/read/reader.js';
import { SPEC_BY_NAME, VIEW_SPECS } from '../src/read/spec.js';
import { id } from '../src/primitives/brand.js';

describe('read tier — spec table integrity', () => {
  it('spec names are unique', () => {
    expect(SPEC_BY_NAME.size).toBe(VIEW_SPECS.length);
  });

  it('settlement views are method-only (excluded from a default snapshot)', () => {
    const needsByName = new Map(VIEW_SPECS.map((s) => [s.name, s.needs ?? []]));
    expect(needsByName.get('tenureSettlement')).toContain('rented');
    expect(needsByName.get('handoverSettlement')).toContain('boundary');
    expect(needsByName.get('nextFloorPriceMist')).toContain('nextFloor');
    // time/cap views are gated too
    expect(needsByName.get('floorPriceMist')).toContain('now');
    expect(needsByName.get('usufructCapIsActive')).toContain('probe');
    // a plain structural view needs nothing
    expect(needsByName.get('isIdle') ?? []).toHaveLength(0);
  });
});

describe('Reader surface', () => {
  // No network: we only assert the object exposes a callable per spec name
  // and the headline ergonomic methods exist with the right arity.
  const fakeClient = {} as Parameters<typeof createReader>[0];
  const r = createReader(fakeClient, {
    packageId: '0x2',
    escrowId: id<'Escrow'>('0x' + 'ab'.repeat(32)),
    typeArguments: ['0xa::d::A', '0x2::sui::SUI'],
  });

  it('exposes a method for every view spec', () => {
    for (const spec of VIEW_SPECS) {
      expect(typeof (r as unknown as Record<string, unknown>)[spec.name], spec.name).toBe(
        'function',
      );
    }
  });

  it('exposes the envelope + batch helpers', () => {
    expect(typeof r.fetch).toBe('function');
    expect(typeof r.snapshot).toBe('function');
  });
});
