/**
 * Sourcing the payment coin for `rent` (Layer 2).
 *
 * The escrow dictates the coin (its `phantom CoinType`); the renter's only
 * decision is the **amount** — pay the floor, or overpay (the surplus becomes
 * stake). So this is not a "which coin" abstraction: it just splits `amountMist`
 * of the escrow's coin from the signer's balance — SUI from the gas coin, any
 * other coin by select/merge/split of the owned `Coin<C>` objects.
 */
import { bcs } from '@mysten/sui/bcs';
import type { ClientWithCoreApi } from '@mysten/sui/client';
import type { Transaction, TransactionObjectArgument } from '@mysten/sui/transactions';
import { normalizeStructTag } from '@mysten/sui/utils';
import { InsufficientBalance } from './errors.js';

const SUI_TYPE = '0x2::sui::SUI';
// Coin<C> BCS: UID (address) then Balance<C> (a single u64) — same flat trick as Clock.
const COIN = bcs.struct('Coin', { id: bcs.Address, balance: bcs.u64() });

/** Split exactly `amountMist` of `coinType` from `owner`'s balance into a PTB arg. */
export async function sourceCoin(
  tx: Transaction,
  client: ClientWithCoreApi,
  owner: string,
  { coinType, amountMist }: { readonly coinType: string; readonly amountMist: bigint },
): Promise<TransactionObjectArgument> {
  // SUI splits from `tx.gas` (avoids conflicting with the gas coin object).
  if (normalizeStructTag(coinType) === normalizeStructTag(SUI_TYPE)) {
    const [out] = tx.splitCoins(tx.gas, [amountMist]);
    return out!;
  }

  // Select owned Coin<C> objects until they cover `amountMist`, merge, split exact.
  const coins: Array<{ objectId: string; balance: bigint }> = [];
  let cursor: string | null = null;
  let total = 0n;
  do {
    const page: Awaited<ReturnType<typeof client.core.listOwnedObjects>> =
      await client.core.listOwnedObjects({
        owner,
        type: `0x2::coin::Coin<${coinType}>`,
        cursor,
        limit: 50,
        include: { content: true },
      });
    for (const o of page.objects) {
      const balance = BigInt(COIN.parse(o.content!).balance);
      coins.push({ objectId: o.objectId, balance });
      total += balance;
    }
    cursor = page.hasNextPage ? page.cursor : null;
  } while (cursor && total < amountMist);

  if (total < amountMist) {
    throw new InsufficientBalance(`need ${amountMist} mist of ${coinType}, own ${total}`);
  }

  const picked: string[] = [];
  let acc = 0n;
  for (const c of coins) {
    picked.push(c.objectId);
    acc += c.balance;
    if (acc >= amountMist) break;
  }
  const [primary, ...rest] = picked;
  const primaryArg = tx.object(primary!);
  if (rest.length > 0) tx.mergeCoins(primaryArg, rest.map((idStr) => tx.object(idStr)));
  const [out] = tx.splitCoins(primaryArg, [amountMist]);
  return out!;
}
