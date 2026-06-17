import { describe, expect, it } from 'vitest';
import { CurveShapePolicy } from '@usufruct-protocol/sdk/codegen/usufruct/curve_shape_policy.js';
import { PolicyEnsemble } from '@usufruct-protocol/sdk/codegen/usufruct/policy_ensemble.js';

describe('codegen BCS substrate', () => {
  it('round-trips an enum with payload', () => {
    const value = { PowerLaw: { alpha_num: 3, alpha_den: 2 } };
    const bytes = CurveShapePolicy.serialize(value).toBytes();
    const parsed = CurveShapePolicy.parse(bytes);
    expect(parsed.$kind).toBe('PowerLaw');
    expect(parsed.PowerLaw).toEqual({ alpha_num: 3, alpha_den: 2 });
  });

  it('round-trips a unit enum variant', () => {
    const bytes = CurveShapePolicy.serialize({ Smoothstep: true }).toBytes();
    expect(CurveShapePolicy.parse(bytes).$kind).toBe('Smoothstep');
  });

  it('exposes a schema for the composite PolicyEnsemble', () => {
    expect(PolicyEnsemble.name).toContain('PolicyEnsemble');
  });
});
