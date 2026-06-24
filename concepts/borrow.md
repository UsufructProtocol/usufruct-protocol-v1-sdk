# Borrow — composing code around the rented asset

> `usufructCap.write.borrow` is the heart of *use*: it hands you the rented asset, in
> the middle of a PTB, to compose with any Sui call. The `borrow` before and the
> `return` after are appended **for you, guaranteed** — you only write the middle.
>
> The whole surface is **one type and one method**:
>
> - **`Use`** — `(asset, tx) => void`. The middle. One zone where the code foreign
>   to the SDK lives. The asset *and the whole `tx`* are yours.
> - **`cap.write.borrow(...uses)`** — a `Plan` that runs one `Use`, or composes several
>   in order, inside the single `borrow_asset … return_asset` bracket. `.send()`
>   signs & sends it; `.build(tx, sender)` drops the bracket into a PTB you drive
>   (see [write model](./write-model.md)).
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

## The three forms of `cap.write.borrow`

### ① Direct lambda — a small middle, inline

When the middle is small and one-off, don't extract it — write it in place:

```ts
const { digest } = await cap.write.borrow((asset, tx) => {
  const coupon = tx.moveCall({ target: `${PKG}::dummy_asset::use_asset`, arguments: [asset] });
  tx.transferObjects([coupon], BOB.toSuiAddress());
}).send();
// PTB: borrow_asset → use_asset → TransferObjects → return_asset
```

### ② Compose snippets — imported recipes, in order

`borrow` is variadic: pass several `Use`s and they apply left-to-right inside the
one bracket.

```ts
import { inspectAsset, useAndKeepCoupon } from './recipes/dummy-asset.js';

const { digest } = await cap.write.borrow(
  inspectAsset,                          // a bare Use (no parentheses)
  useAndKeepCoupon(BOB.toSuiAddress()),  // a factory → Use
).send();
// PTB: borrow_asset → uses → use_asset → TransferObjects → return_asset
```

The forms **mix freely** — an imported recipe and a raw lambda in the same call:

```ts
await cap.write.borrow(
  inspectAsset,                          // imported
  useAndKeepCoupon(BOB.toSuiAddress()),  // factory
  (asset, tx) => {                       // raw lambda, mid-PTB
    const fee = tx.splitCoins(tx.gas, [1_000])[0]!;
    tx.transferObjects([fee], ALICE.toSuiAddress());
  },
).send();
```

Repeating a step repeats its commands, in order — three uses of one rented asset,
one atomic PTB:

```ts
await cap.write.borrow(
  inspectAsset,
  useAndKeepCoupon(BOB.toSuiAddress()),
  useAndKeepCoupon(BOB.toSuiAddress()),
  useAndKeepCoupon(BOB.toSuiAddress()),
).send();
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

await cap.write.borrow(...dailyRoutine).send();                        // as is
await cap.write.borrow(...dailyRoutine, useAndKeepCoupon(DAN)).send(); // with an extra step appended
```

Because it is an array, you compose it with ordinary JavaScript —
`dailyRoutine.filter(…)`, `[...a, ...b]`, `routine.map(…)`.

## `Plan.build` — when you drive the PTB

`cap.write.borrow(...)` is a `Plan`. `.send()` does build + execute + decode; `.build(tx,
sender)` does only the build — it appends the bracket to a transaction you own, so
you run execute yourself. Reach for `.build` when you need the transaction in your
own hands. (This is the general write seam — see [write model](./write-model.md).)

| | `await cap.write.borrow(...).send()` | `await cap.write.borrow(...).build(tx, me)` |
|---|---|---|
| Who creates the `tx`? | the SDK | **you** |
| Signs & sends? | yes | **no** (just appends) |
| Needs an executor | yes (default or passed) | no — you execute later |
| Returns | `BorrowReceipt` (digest) | nothing — appends to your `tx` |

Three reasons to reach for it:

```ts
// ① Sponsorship — someone else pays gas / co-signs
const tx = new Transaction();
await cap.write.borrow(useAndKeepCoupon(BOB.toSuiAddress())).build(tx, ME);
// sponsor adds gas & signs as sponsor; the renter signs as sender

// ② Batching — mix the borrow with unrelated commands in one atomic tx
const tx = new Transaction();
await cap.write.borrow(inspectAsset, useAndKeepCoupon(BOB.toSuiAddress())).build(tx, ME);
tx.transferObjects([tx.splitCoins(tx.gas, [500])[0]!], ALICE.toSuiAddress());

// ③ Several brackets — use two rented assets in the same transaction
const tx = new Transaction();
await capA.write.borrow(recipeForA).build(tx, ME);   // bracket for asset A
await capB.write.borrow(recipeForB).build(tx, ME);   // bracket for asset B, same tx
// two borrows, two returns, one atomic PTB — impossible with .send() alone,
// since each .send() builds and sends its own transaction.
```

## The one rule

> **Writing a recipe** — no args & one call? a `Use` lambda or constant. Needs
> args? a factory `(args) => Use`. It is always just a `Use`.
>
> **Injecting it** — one or several, right here? `await cap.write.borrow(a, b, c).send()`.
> A reusable bundle? a `Use[]` spread. Your own PTB (sponsorship / batching / many
> brackets)? `await cap.write.borrow(…).build(tx, me)`.

Everything is a `Use`; `borrow` runs one or composes many. The chain is the
arbiter — external calls must take the asset **by reference** (`&Asset` /
`&mut Asset`); consuming it by value leaves nothing to return and the PTB is
rejected at resolution.

## The by-value escape hatch — drop to the primitives

`cap.write.borrow` is `&Asset`/`&mut Asset` on purpose: it returns the *same*
handle it borrowed, so its bracket is unbreakable — you cannot fail to return the
right object. The rare case is a Move fn that takes the asset **by value** and
returns it intact (`fun f(a: Asset): Asset`). The protocol allows it — `return_asset`
only asserts the returned object has the **same id** (else `EReturnedDifferentAsset`)
— but the high-level bracket can't express it (a by-value move spends the handle
the auto-`return` reuses). For that one case, drop to the bare actions and thread
the returned handle into `return_asset` yourself:

```ts
import { borrowToPtb, returnAssetToPtb } from '@usufruct-protocol/sdk/actions/borrow.js';

const [asset, receipt] = borrowToPtb()(tx, ptbArgs);
const moved = tx.moveCall({ target: `${PKG}::game::play`, arguments: [asset] }); // play(a: Asset): Asset
returnAssetToPtb(tx, { pkg, escrowId, asset: moved, receipt, typeArguments });    // give back the moved handle
```

This is deliberately **not** a second high-level method: it would duplicate `borrow`
on the handle while shedding its one guarantee (you'd drive the return either way).
The primitives are the honest home — full PTB control, the chain enforces the id.

See [api design](./api-design.md) for why possession is the role (why `borrow`
proves the cap belongs to its escrow) and where `borrow` sits among the five verbs,
and [primitives](./primitives.md) for the by-value escape hatch in context.
