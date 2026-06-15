import { bcs } from '@mysten/sui/bcs';
import type { ClientWithCoreApi } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { describe, expect, it } from 'vitest';
import { isCoinSource, resolvePayment } from '../src/highlevel/coins.js';
import { InsufficientBalance, InsufficientPayment, mapAbort } from '../src/highlevel/errors.js';
import { SUI, coinTag } from '../src/highlevel/value.js';

const DUMMY = coinTag({ type: '0xd::dummy_coin::DUMMY_COIN', decimals: 9, symbol: 'DUMMY' });
const COIN = bcs.struct('Coin', { id: bcs.Address, balance: bcs.u64() });

/** Fake client serving `owner`'s Coin<C> objects with the given balances. */
function fakeCoins(balances: bigint[]): ClientWithCoreApi {
  return {
    core: {
      listOwnedObjects: async () => ({
        objects: balances.map((b, i) => ({
          objectId: `0xcoin${i}`,
          content: COIN.serialize({ id: `0x${i}`, balance: b.toString() }).toBytes(),
        })),
        hasNextPage: false,
        cursor: null,
      }),
    },
  } as unknown as ClientWithCoreApi;
}

const NO_CLIENT = {} as ClientWithCoreApi;

describe('highlevel/coins — isCoinSource', () => {
  it('recognises sources, rejects raw coin args', () => {
    expect(isCoinSource({ kind: 'minimum', coin: SUI })).toBe(true);
    expect(isCoinSource({ kind: 'exact', coin: SUI, amountMist: 1n })).toBe(true);
    const tx = new Transaction();
    expect(isCoinSource(tx.object('0x123'))).toBe(false);
  });
});

describe('highlevel/coins — resolvePayment', () => {
  it("'minimum' yields exactly floor×count (the minimum)", async () => {
    const tx = new Transaction();
    const { paidMist } = await resolvePayment(tx, fakeCoins([1_000n]), '0xbob',
      { kind: 'minimum', coin: DUMMY }, { minimumMist: 600n, coinType: DUMMY.type });
    expect(paidMist).toBe(600n);
  });

  it("'exact' yields the requested amount (overpay → stake)", async () => {
    const tx = new Transaction();
    const { paidMist } = await resolvePayment(tx, fakeCoins([1_000n]), '0xbob',
      { kind: 'exact', coin: DUMMY, amountMist: 750n }, { minimumMist: 600n, coinType: DUMMY.type });
    expect(paidMist).toBe(750n);
  });

  it('SUI splits from gas (no owned-object lookup)', async () => {
    const tx = new Transaction();
    const { paidMist } = await resolvePayment(tx, NO_CLIENT, '0xbob',
      { kind: 'minimum', coin: SUI }, { minimumMist: 500n, coinType: SUI.type });
    expect(paidMist).toBe(500n);
  });

  it('merges multiple owned coins to cover the target', async () => {
    const tx = new Transaction();
    const { paidMist } = await resolvePayment(tx, fakeCoins([100n, 200n, 400n]), '0xbob',
      { kind: 'minimum', coin: DUMMY }, { minimumMist: 650n, coinType: DUMMY.type });
    expect(paidMist).toBe(650n);
  });

  it('throws InsufficientBalance when owned coins cannot cover', async () => {
    const tx = new Transaction();
    await expect(resolvePayment(tx, fakeCoins([100n, 200n]), '0xbob',
      { kind: 'minimum', coin: DUMMY }, { minimumMist: 650n, coinType: DUMMY.type }))
      .rejects.toBeInstanceOf(InsufficientBalance);
  });

  it('throws when the source coin ≠ the escrow coin', async () => {
    const tx = new Transaction();
    await expect(resolvePayment(tx, fakeCoins([1_000n]), '0xbob',
      { kind: 'minimum', coin: SUI }, { minimumMist: 1n, coinType: DUMMY.type }))
      .rejects.toBeInstanceOf(InsufficientBalance);
  });

  it('returns a raw coin arg as-is', async () => {
    const tx = new Transaction();
    const raw = tx.object('0xmycoin');
    const { arg, paidMist } = await resolvePayment(tx, NO_CLIENT, '0xbob', raw,
      { minimumMist: 42n, coinType: DUMMY.type });
    expect(arg).toBe(raw);
    expect(paidMist).toBe(42n);
  });
});

describe('highlevel/errors — mapAbort', () => {
  it('maps EInsufficientPayment (asset_state code 1) to a typed error', () => {
    const e = new Error("MoveAbort in 1st command, abort code: 1, in '0xpkg::asset_state::execute_rent' (instruction 3)");
    expect(() => mapAbort(e)).toThrow(InsufficientPayment);
  });

  it('rethrows unknown errors unchanged', () => {
    const e = new Error('something else');
    expect(() => mapAbort(e)).toThrow(e);
  });
});
