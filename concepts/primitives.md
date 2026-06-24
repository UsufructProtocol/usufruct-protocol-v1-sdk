# Primitives vs the high-level — and why the primitives compose the high-level

> The high-level API (`usufruct()`, the handles) is **not a reimplementation** — it
> is a thin composition of the kernel primitives. Every verb you call resolves to
> `actions.*` (build a PTB), the `Reader` (read a view), or `Source` (IO). Knowing
> the seam tells you exactly when to drop a level for control you can't get up top.

## The two layers

| | Primitives (kernel) | High-level (handles) |
|---|---|---|
| Where | `@usufruct-protocol/sdk/actions/*`, `u.primitives` (`Source` + `Reader`) | `usufruct()` → `Escrow`/`UsufructCap`/`GovernanceCap`/inboxes |
| Shape | unbound functions: `rentToPtb()(tx, args)`, `reader.floorPriceMist()` | object-centric verbs: `escrow.write.rent(...)`, `escrow.read.floorPrice()` |
| Returns | a PTB value / a raw bigint — you compose | a domain result (`UsufructCap`, `Price`), executed + decoded |
| Decides destination | **no** — the minted object is a value you place | **yes** — appends `transferObjects([minted], to ?? sender)` |
| Drift | the source of truth (the `Reader` runs the deployed views) | renders the primitives; cannot add drift |

The mirror `@usufruct-protocol/sim` is a *third*, opt-in tier — the off-chain
re-derivation (`EscrowState`, `View`, `Action.step`) for simulation/what-if,
golden-tested against the `Reader`. The dependency arrow is **sim → sdk**.

## Primitives return by value; the high-level picks a destination

The Move calls that mint objects return them **by value** — the protocol does *not*
decide a destination:

```move
public fun integrate<...>(...): (GovernanceCap, EarningsInbox)
public fun rent<...>(...): UsufructCap
public fun borrow_asset<...>(...): (Asset, AssetReceipt)
```

In Move a returned object *must* be consumed in the PTB (transferred, wrapped, passed
on) or the transaction won't build. So the destination is a PTB decision — and that
is exactly where the layers divide:

- **Primitives** hand you the value to compose: transfer it, feed it into another
  call, batch it, sponsor it. Nothing is implied.
- **High-level** makes the common choice — `tx.transferObjects([minted], sender)` —
  so the object lands in your wallet. The `to` option overrides the destination
  without leaving the layer (`rent({ …, to })`, `integrate({ …, to })`,
  `claim(escrow, { to })`).

So "the cap arrives in my wallet" is a **high-level convenience, not protocol
behaviour**. The same by-value return is what makes a secondary market, a treasury
split, or routing a minted object straight into another Move call possible at the
primitive layer.

## Reads: curated handle views vs the full kernel reader

Both are **live** (each call hits the chain) and drift-zero; they differ only in
surface:

| | `escrow.read.*` | `u.primitives.reader(target).*` |
|---|---|---|
| Surface | the curated hot fields + composites, rendered (`Price`/`Date`) | the ~80 raw kernel views (policy unions, exact bigints) |
| Coherence | per-call; `escrow.read.snapshot()` for one cross-section at `t` | per-call |
| Use for | the 95% — render, decide, act | a view the handle doesn't surface; exact mist |

The `Reader` hangs straight off the root with **no re-wiring** — `packageId`,
`escrowId`, and type args come from the handle — and the *same* reader answers before
*and* after a write (each call is its own round-trip):

```ts
const { escrow, governanceCap } = await u.write.integrate({ asset, coin, market }).send();
const reader = u.primitives.reader(escrow);                    // live kernel views, off the handle

const before = (await reader.restPrice()).priceMist;           // 10_000_000n
await governanceCap.write.updateMarket(escrow, { restPrice: COIN(0.025) }).send();
const after  = (await reader.restPrice()).priceMist;           // 25_000_000n — same `reader`
```

One subtlety: the Reader shows **real chain state, not a lazily-computed view**.
After a tenure lapses but *before* you apply the transition,
`reader.activeUsufructCapId()` still returns the sitting cap — the chain hasn't
settled yet. `escrow.write.applyPendingTransitionStates()` materializes it. Both
layers agree on the protocol's lazy semantics: nothing settles until a transaction
touches the escrow.

## When to drop to the primitives

The high-level covers the 95%. Reach down when you need PTB control it doesn't model:

| Need | Drop to |
|---|---|
| A view the handle doesn't surface (raw mist, policy unions) | `u.primitives.reader(target)` |
| Route a minted object straight into **another Move call** (not just transfer) | `rentToPtb` / `integrateToPtb` — the value is yours |
| **By-value** borrow (`fun f(a: Asset): Asset`) | `borrowToPtb` + `returnAssetToPtb`, thread the handle (see [borrow](./borrow.md)) |
| Custom PTB: mix raw commands, several writes, sponsorship | `plan.build(tx, sender)` (the write seam — see [write model](./write-model.md)) |
| Raw IO / your own event scan | `u.primitives.source` (`fetch`/`query`/`subscribe`) |

The escape hatches are imports, not a different SDK:

```ts
import { borrowToPtb, returnAssetToPtb, rentToPtb } from '@usufruct-protocol/sdk/actions/borrow.js';
// …and u.primitives.{ reader(target), source } off the root handle.
```

## The principle

> The high-level *is* the primitives, composed with one opinionated default
> (transfer-to-sender) and a rendered surface (`Price`/`Date`). Nothing up top is
> beyond reach down below — when the default or the curated surface doesn't fit, you
> drop a level and the chain is still the arbiter. The seam is a feature: ergonomics
> by default, full control on demand.

See [api design](./api-design.md) for the five-verb model the high-level exposes, and
[`ARCHITECTURE.md`](../ARCHITECTURE.md) / [`SPEC.md`](../SPEC.md) for the drift-zero
seam in full.
