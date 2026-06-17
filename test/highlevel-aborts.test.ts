/**
 * Offline coverage for the generated abort registry + mapAbort. Feeds fabricated
 * abort strings in the live format and asserts every (module, code) resolves to a
 * typed error carrying the verbatim Move constant name.
 */
import { describe, expect, it } from 'vitest';
import { MOVE_ABORTS } from '@usufruct-protocol/sdk/highlevel/aborts.generated.js';
import {
  mapAbort,
  MoveAbortError,
  InsufficientPayment,
  NotAvailable,
  CommittedRetire,
  CommittedEnsemble,
  NotGovernor,
  InvalidEscalation,
  InvalidShape,
  InvalidMarket,
  NotConnected,
} from '@usufruct-protocol/sdk/highlevel/errors.js';

const PKG = '0x415c4372bb9db5affe2ab2bf6d72a6a667ed3178a61d6201e9ff26dc76380e5d';
// The shape runtime aborts arrive in (verified live).
const abortMsg = (module: string, code: number) =>
  new Error(`MoveAbort ... abort code: ${code}, in '${PKG}::${module}::do_thing' ...`);

const find = (name: string) => MOVE_ABORTS.find((a) => a.name === name);

describe('MOVE_ABORTS registry (generated from source)', () => {
  it('covers the 39 runtime constants with the source nomenclature', () => {
    expect(MOVE_ABORTS).toHaveLength(39);
    // anchors across modules, by exact (module, code, name)
    expect(find('EAlreadyRetired')).toEqual({ module: 'asset_state', code: 5, name: 'EAlreadyRetired' });
    expect(find('ENotRented')).toEqual({ module: 'asset_state', code: 0, name: 'ENotRented' });
    expect(find('EAlphaNumRange')).toEqual({ module: 'curve_shape_policy', code: 0, name: 'EAlphaNumRange' });
    expect(find('EBpsRange')).toEqual({ module: 'price_escalation_policy', code: 1, name: 'EBpsRange' });
    expect(find('EHandoverFloorExceedsTenure')).toEqual({
      module: 'policy_ensemble',
      code: 0,
      name: 'EHandoverFloorExceedsTenure',
    });
  });

  it('excludes #[test_only] constants (they never abort at runtime)', () => {
    for (const name of ['ENotPowerLaw', 'ENotFixedDelta', 'ENotCompoundDelta', 'EDescentOffNoFixed']) {
      expect(find(name)).toBeUndefined();
    }
  });

  it('every (module, code) is unique — the abort identity', () => {
    const keys = MOVE_ABORTS.map((a) => `${a.module}:${a.code}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('mapAbort', () => {
  it('resolves every registry entry to a MoveAbortError naming the constant', () => {
    for (const a of MOVE_ABORTS) {
      try {
        mapAbort(abortMsg(a.module, a.code));
        throw new Error(`expected mapAbort to throw for ${a.module}#${a.code}`);
      } catch (e) {
        expect(e).toBeInstanceOf(MoveAbortError);
        const err = e as MoveAbortError;
        expect(err.abort).toBe(a.name); // verbatim Move constant
        expect(err.module).toBe(a.module);
        expect(err.code).toBe(a.code);
        expect(err.message).toContain(a.name);
      }
    }
  });

  it('throws the friendly overlay subclass for common aborts (still naming the constant)', () => {
    const cases: Array<[string, number, new (...a: never[]) => MoveAbortError, string]> = [
      ['asset_state', 1, InsufficientPayment, 'EInsufficientPayment'],
      ['asset_state', 2, NotAvailable, 'ERetireFlagBlocksBid'],
      ['asset_state', 4, CommittedRetire, 'ERetireCommitmentFloorNotElapsed'],
      ['asset_state', 18, CommittedEnsemble, 'EEnsembleCommitmentFloorNotElapsed'],
      ['asset_state', 11, NotGovernor, 'EWrongEscrowGovernanceCap'],
      ['price_escalation_policy', 1, InvalidEscalation, 'EBpsRange'],
      ['curve_shape_policy', 2, InvalidShape, 'EDegenerateLinear'],
      ['rest_price_policy', 0, InvalidMarket, 'EPriceZero'],
    ];
    for (const [mod, code, Ctor, name] of cases) {
      try {
        mapAbort(abortMsg(mod, code));
        throw new Error('expected throw');
      } catch (e) {
        expect(e).toBeInstanceOf(Ctor);
        expect(e).toBeInstanceOf(MoveAbortError);
        expect((e as MoveAbortError).abort).toBe(name);
      }
    }
  });

  it('rethrows unknown aborts and non-abort errors unchanged', () => {
    // an abort code not in any module → unknown → rethrow original
    const unknown = abortMsg('asset_state', 999);
    expect(() => mapAbort(unknown)).toThrow(unknown);
    // a plain non-abort error → rethrow as-is (not a MoveAbortError)
    const plain = new NotConnected('no signer');
    try {
      mapAbort(plain);
    } catch (e) {
      expect(e).toBe(plain);
      expect(e).not.toBeInstanceOf(MoveAbortError);
    }
  });
});
