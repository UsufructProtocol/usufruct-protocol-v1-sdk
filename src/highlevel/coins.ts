/**
 * Coin sourcing for the high-level API (Layer 2).
 *
 * `payment` is a real `Coin<C>` argument of `rent` — never hidden (only the
 * `Clock` and `ProtocolFeeRef` singletons are). The developer either passes a
 * coin they control, or *opts in* to a `CoinSource` they write here. Resolved
 * against the signer's owned coins at PTB-build time.
 *
 * NOTE: implementation lands in Phase C; this is the shared type the factory
 * (`u.coin` / `u.fromBalance`) and `escrow.rent` agree on.
 */
import { bcs } from '@mysten/sui/bcs';
import type { ClientWithCoreApi } from '@mysten/sui/client';
import type { Transaction, TransactionObjectArgument } from '@mysten/sui/transactions';
import { InsufficientBalance } from './errors.js';
import type { CoinTag } from './value.js';

/**
 * An explicit, opt-in instruction for where a payment coin comes from.
 * - `{ kind: 'exact' }` — split exactly `amountMist` from the signer's `Coin<C>`.
 * - `{ kind: 'minimum' }` — let the call split exactly what it needs (`floor×count`).
 */
export type CoinSource =
  | { readonly kind: 'exact'; readonly coin: CoinTag; readonly amountMist: bigint }
  | { readonly kind: 'minimum'; readonly coin: CoinTag };

/** Either a coin object you already control, or an opt-in `CoinSource` to build one. */
export type Payment = TransactionObjectArgument | CoinSource;

const SUI_TYPE = '0x2::sui::SUI';
// Coin<C> BCS: UID (address) then Balance<C> (a single u64) — same flat trick as Clock.
const COIN = bcs.struct('Coin', { id: bcs.Address, balance: bcs.u64() });

export function isCoinSource(p: Payment): p is CoinSource {
  return typeof p === 'object' && p !== null && 'kind' in p &&
    ((p as CoinSource).kind === 'exact' || (p as CoinSource).kind === 'minimum');
}

/** The exact mist a `CoinSource` should yield, given the call's minimum (`floor×count`). */
function targetMist(source: CoinSource, minimumMist: bigint): bigint {
  return source.kind === 'exact' ? source.amountMist : minimumMist;
}

/**
 * Resolve a `payment` into a PTB coin argument. A raw coin is returned as-is;
 * a `CoinSource` is realised against the signer's owned `Coin<C>`:
 * - SUI splits from `tx.gas` (avoids conflicting with the gas coin object);
 * - any other coin selects/merges the owned objects, then splits the target.
 */
export async function resolvePayment(
  tx: Transaction,
  client: ClientWithCoreApi,
  owner: string,
  payment: Payment,
  ctx: { readonly minimumMist: bigint; readonly coinType: string },
): Promise<{ arg: TransactionObjectArgument; paidMist: bigint }> {
  if (!isCoinSource(payment)) {
    // A coin the developer controls; its full value becomes stake (≥ minimum assumed).
    return { arg: payment, paidMist: ctx.minimumMist };
  }
  if (payment.coin.type !== ctx.coinType) {
    throw new InsufficientBalance(
      `payment coin ${payment.coin.type} ≠ escrow coin ${ctx.coinType}`,
    );
  }

  const target = targetMist(payment, ctx.minimumMist);

  if (ctx.coinType === SUI_TYPE) {
    const [out] = tx.splitCoins(tx.gas, [target]);
    return { arg: out, paidMist: target };
  }

  // Select owned Coin<C> objects until they cover `target`, merge, split exact.
  const coins: Array<{ objectId: string; balance: bigint }> = [];
  let cursor: string | null = null;
  let total = 0n;
  do {
    const page: Awaited<ReturnType<typeof client.core.listOwnedObjects>> =
      await client.core.listOwnedObjects({
        owner,
        type: `0x2::coin::Coin<${ctx.coinType}>`,
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
  } while (cursor && total < target);

  if (total < target) {
    throw new InsufficientBalance(
      `need ${target} mist of ${ctx.coinType}, own ${total}`,
    );
  }

  // Greedy: take coins until covered.
  const picked: string[] = [];
  let acc = 0n;
  for (const c of coins) {
    picked.push(c.objectId);
    acc += c.balance;
    if (acc >= target) break;
  }
  const [primary, ...rest] = picked;
  const primaryArg = tx.object(primary!);
  if (rest.length > 0) tx.mergeCoins(primaryArg, rest.map((idStr) => tx.object(idStr)));
  const [out] = tx.splitCoins(primaryArg, [target]);
  return { arg: out, paidMist: target };
}
