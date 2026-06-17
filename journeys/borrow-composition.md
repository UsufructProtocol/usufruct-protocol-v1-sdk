# Borrow — composing code around the rented asset

> `usufructCap.borrow` is the heart of *use*: it hands you the rented asset, in
> the middle of a PTB, to compose with any Sui call. The `borrow` before and the
> `return` after are appended **for you, guaranteed** — you only write the middle.
>
> The whole surface is **one type and one method**:
>
> - **`Use`** — `(asset, tx) => void`. The middle. One zone where the code foreign
>   to the SDK lives. The asset *and the whole `tx`* are yours.
> - **`cap.borrow(...uses)`** — run one `Use`, or compose several in order, inside
>   the single `borrow_asset … return_asset` bracket. `cap.borrow.into(tx, ...)`
>   drops that bracket into a PTB you drive yourself.
>
> There is nothing else to learn: a lambda is a `Use`, a named constant is a
> `Use`, a factory returns a `Use`, a routine is a `Use[]`. The raw
> `(asset, tx) =>` lambda — with the whole `tx` — is always the floor.

## Writing a recipe — a `Use` is just a value

A recipe is any `Use`. Write it where it makes sense:

```ts
import type { Use } from '@usufruct-protocol/sdk';
const PKG = '0xa72e…a52a';

// no args → a bare Use constant
export const inspectAsset: Use = (asset, tx) => {
  tx.moveCall({ target: `${PKG}::dummy_asset::uses`, arguments: [asset] });
};

// needs args → a factory (args) => Use (it closes over `recipient`)
export const useAndKeepCoupon = (recipient: string): Use => (asset, tx) => {
  const coupon = tx.moveCall({ target: `${PKG}::dummy_asset::use_asset`, arguments: [asset] });
  tx.transferObjects([coupon], recipient);
};
```

The factory `(args) => Use` is plain JavaScript, not an SDK concept — it is just
"a function that returns a recipe". Reach for it whenever the recipe needs a
parameter (a recipient, an amount, another object id).

## The three forms of `cap.borrow`

### ① Direct lambda — a small middle, inline

When the middle is small and one-off, don't extract it — write it in place:

```ts
const { digest } = await cap.borrow((asset, tx) => {
  const coupon = tx.moveCall({ target: `${PKG}::dummy_asset::use_asset`, arguments: [asset] });
  tx.transferObjects([coupon], BOB.toSuiAddress());
});
// PTB: borrow_asset → use_asset → TransferObjects → return_asset
```

### ② Compose snippets — imported recipes, in order

`borrow` is variadic: pass several `Use`s and they apply left-to-right inside the
one bracket.

```ts
import { inspectAsset, useAndKeepCoupon } from './recipes/dummy-asset.js';

const { digest } = await cap.borrow(
  inspectAsset,                          // a bare Use (no parentheses)
  useAndKeepCoupon(BOB.toSuiAddress()),  // a factory → Use
);
// PTB: borrow_asset → uses → use_asset → TransferObjects → return_asset
```

The forms **mix freely** — an imported recipe and a raw lambda in the same call:

```ts
await cap.borrow(
  inspectAsset,                          // imported
  useAndKeepCoupon(BOB.toSuiAddress()),  // factory
  (asset, tx) => {                       // raw lambda, mid-PTB
    const fee = tx.splitCoins(tx.gas, [1_000])[0]!;
    tx.transferObjects([fee], ALICE.toSuiAddress());
  },
);
```

Repeating a step repeats its commands, in order — three uses of one rented asset,
one atomic PTB:

```ts
await cap.borrow(
  inspectAsset,
  useAndKeepCoupon(BOB.toSuiAddress()),
  useAndKeepCoupon(BOB.toSuiAddress()),
  useAndKeepCoupon(BOB.toSuiAddress()),
);
// PTB: borrow_asset → uses → (use_asset → Transfer) ×3 → return_asset
```

### ③ A reusable routine — a `Use[]` spread in

A "bundle" you reuse is a plain array — no named composer needed:

```ts
const dailyRoutine: Use[] = [
  inspectAsset,
  useAndKeepCoupon(BOB.toSuiAddress()),
  useAndKeepCoupon(CAROL.toSuiAddress()),
];

await cap.borrow(...dailyRoutine);                        // as is
await cap.borrow(...dailyRoutine, useAndKeepCoupon(DAN)); // with an extra step appended
```

Because it is an array, you compose it with ordinary JavaScript —
`dailyRoutine.filter(…)`, `[...a, ...b]`, `routine.map(…)`.

## `borrow.into` — when you drive the PTB

`cap.borrow(...)` is `cap.borrow.into(...)` **plus** creating the transaction,
signing, and sending. Use `into` when you need the transaction in your own hands.

| | `cap.borrow(...)` | `cap.borrow.into(tx, ...)` |
|---|---|---|
| Who creates the `tx`? | the SDK | **you** |
| Signs & sends? | yes | **no** (returns `void`) |
| Needs a signer? | yes | no |
| Returns | `Promise<BorrowReceipt>` (digest) | nothing — appends to your `tx` |

Three reasons to reach for it:

```ts
// ① Sponsorship — someone else pays gas / co-signs
const tx = new Transaction();
cap.borrow.into(tx, useAndKeepCoupon(BOB.toSuiAddress()));
// sponsor adds gas & signs as sponsor; the renter signs as sender

// ② Batching — mix the borrow with unrelated commands in one atomic tx
const tx = new Transaction();
cap.borrow.into(tx, inspectAsset, useAndKeepCoupon(BOB.toSuiAddress()));
tx.transferObjects([tx.splitCoins(tx.gas, [500])[0]!], ALICE.toSuiAddress());

// ③ Several brackets — use two rented assets in the same transaction
const tx = new Transaction();
capA.borrow.into(tx, recipeForA);   // bracket for asset A
capB.borrow.into(tx, recipeForB);   // bracket for asset B, same tx
// two borrows, two returns, one atomic PTB — impossible with borrow() alone,
// since each borrow() builds and sends its own transaction.
```

## The one rule

> **Writing a recipe** — no args & one call? a `Use` lambda or constant. Needs
> args? a factory `(args) => Use`. It is always just a `Use`.
>
> **Injecting it** — one or several, right here? `cap.borrow(a, b, c)`. A reusable
> bundle? a `Use[]` spread. Your own PTB (sponsorship / batching / many brackets)?
> `cap.borrow.into(tx, …)`.

Everything is a `Use`; `borrow` runs one or composes many. The chain is the
arbiter — external calls must take the asset **by reference** (`&Asset` /
`&mut Asset`); consuming it by value leaves nothing to return and the PTB is
rejected at resolution.

See [the object model](./object-model.md) for why `borrow` proves the cap belongs
to its escrow, and [read · write · inspect · react](./read-write-inspect-react.md)
for where `borrow` sits among the four verbs.
