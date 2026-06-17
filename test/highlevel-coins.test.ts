import { bcs } from '@mysten/sui/bcs';
import type { ClientWithCoreApi } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { describe, expect, it } from 'vitest';
import { sourceCoin } from '@usufruct-protocol/sdk/highlevel/coins.js';
import { InsufficientBalance, InsufficientPayment, mapAbort } from '@usufruct-protocol/sdk/highlevel/errors.js';
import { SUI } from '@usufruct-protocol/sdk/highlevel/value.js';

const DUMMY_T = '0xd::dummy_coin::DUMMY_COIN';
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

describe('highlevel/coins — sourceCoin (the amount is the only decision)', () => {
  it('splits SUI from gas — no owned-object lookup', async () => {
    const tx = new Transaction();
    // NO_CLIENT proves the SUI branch never touches the client.
    const arg = await sourceCoin(tx, NO_CLIENT, '0xbob', { coinType: SUI.type, amountMist: 500n });
    expect(arg).toBeDefined();
  });

  it('SUI branch is address-normalized (0x2 ≡ 0x000…2)', async () => {
    const tx = new Transaction();
    const long = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';
    const arg = await sourceCoin(tx, NO_CLIENT, '0xbob', { coinType: long, amountMist: 1n });
    expect(arg).toBeDefined(); // resolved via gas, not the owned-coin path
  });

  it('selects/merges owned coins to cover the amount', async () => {
    const tx = new Transaction();
    const arg = await sourceCoin(tx, fakeCoins([100n, 200n, 400n]), '0xbob', { coinType: DUMMY_T, amountMist: 650n });
    expect(arg).toBeDefined();
  });

  it('throws InsufficientBalance when owned coins cannot cover the amount', async () => {
    const tx = new Transaction();
    await expect(
      sourceCoin(tx, fakeCoins([100n, 200n]), '0xbob', { coinType: DUMMY_T, amountMist: 650n }),
    ).rejects.toBeInstanceOf(InsufficientBalance);
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
