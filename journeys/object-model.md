# The object model — possession is the role

> The high-level API is **object-centric, not role-centric.** A "governor",
> "usufructuary", "earnings collector" is not an identity the SDK tracks — it is
> *whoever currently holds the corresponding object*. The objects move; the roles
> move with them.

## The principle

The protocol has four capability objects, all `key + store` (verified in source):

| Object | `has` | Created at | Initial holder |
|---|---|---|---|
| `GovernanceCap` | `key, store` (`governance_cap.move:17`) | `integrate` | the integrator |
| `EarningsInbox` | `key, store` (`earnings_inbox.move:14`) | `integrate` | the integrator |
| `UsufructCap` | `key, store` (`usufruct_cap.move:17`) | `rent` | the renter |
| `ProtocolFeeInbox` | `key, store` (`protocol_fee_inbox.move:16`) | deploy (`public_transfer` to sender) | the deployer |

`store` means anyone can `public_transfer` them. And Move makes the authority
**possession itself**: to produce a `&GovernanceCap`, `&mut EarningsInbox`, or
`&UsufructCap` inside a PTB you must pass `tx.object(id)` — which only succeeds if
the *signer owns it*. So:

- Holding the `GovernanceCap` makes you the **governor** — not necessarily the
  address that called `integrate`.
- Holding the `EarningsInbox` lets you **collect earnings** — maybe a treasury
  address, not the governor.
- Holding the `UsufructCap` makes you the **usufructuary** — not necessarily the
  address that called `rent` (the right of use is a tradable bearer instrument).
- Holding the `ProtocolFeeInbox` lets you **collect fees** — the deployer, or
  whoever they hand it to.

**The role is emergent from possession.** Modelling a "Governor" that *owns* its
cap and inbox is backwards — and it lies exactly where it matters: selling the
governance of a market, pointing earnings at a treasury, a secondary market for
rights of use, an integrator handing everything off.

## The handle taxonomy — one handle per capability object

Names are **explicit about the object** — never a bare `cap`/`earnings` (which
cap? whose earnings?):

| Object | Handle | Writes (authority = holding it) | Door |
|---|---|---|---|
| `Escrow` (shared) | `Escrow` | `rent`, `apply` (permissionless) + reads | `u.escrow(id)` |
| `UsufructCap` | `UsufructCap` | `borrow`/`.into`, `updateRefundAddress`, `burnIfStale`, `burn`, **`transfer`** | `u.usufructCap(id)` |
| `GovernanceCap` | `GovernanceCap` | `updateMarket`/`retire`/`claim`/`extend*`, `renounce`, `integrateIntoPortfolio`, **`transfer`** | `u.governanceCap(id)` |
| `EarningsInbox` | `EarningsInbox` | `balance`, `collect`, **`transfer`** | `u.earningsInbox(id)` |
| `ProtocolFeeInbox` | `ProtocolFeeInbox` | `balance`, `collect`, **`transfer`** | `u.feeInbox()` — singleton, resolved from the `ProtocolFeeRef` (or `u.feeInbox(id)`) |

There is **no `Governor`** handle. `integrate` mints three objects and returns
three independent handles:

```ts
const { escrow, governanceCap, earningsInbox } = await u.integrate({ asset, coin, market });
// each is a separate bearer object; they can diverge from here.
```

The per-escrow governance writes name their target escrow (one cap governs a
portfolio): `governanceCap.updateMarket(escrow, market)`. Adding a new asset to
the portfolio is the one write that depends on **two** objects — the cap (the
portfolio it joins) and the inbox it pays into — so both are named explicitly:

```ts
await governanceCap.integrateIntoPortfolio(asset, coin, market, { earningsInbox: earningsInbox.inboxId });
```

The `coin` is a parameter of `integrate` / `integrateIntoPortfolio`, **never a
`Market` field**: in Move it's a `phantom CoinType` baked into the escrow's type
at genesis and immutable thereafter. A `Market` is the mutable policy you can
`updateMarket`; the coin is not, so it lives where it's decided once — and a
portfolio may hold escrows of different coins, all paying one inbox.

## `transfer` is first-class — moving the object moves the role

Every bearer handle has `transfer(to)` (`tx.transferObjects([tx.object(id)], to)`,
signed by the current holder). This is the whole point, not an afterthought:

```ts
await governanceCap.transfer(treasury);   // hand off governance
await earningsInbox.transfer(treasury);   // route income elsewhere
await usufructCap.transfer(buyer);        // sell the right of use
```

After the transfer, the new holder governs/collects/uses; the old holder's
handle no longer works (the chain rejects a `tx.object(id)` it doesn't own →
`NotGovernor` / not-owned).

## The Escrow: identities (data) vs holdings (what *I* hold)

The escrow knows, as plain data, **which objects relate to it** — regardless of
who holds them:

```ts
escrow.governanceCapId;     // the cap that governs this escrow
escrow.earningsInboxId;     // the inbox it pays into
escrow.feeInboxId;          // the protocol fee inbox
escrow.activeUsufructCapId; // the current right-of-use cap (or null)
```

Separately, it resolves **which of those the signer currently holds**, as ready
handles (else `null`):

```ts
escrow.usufructCap;   // UsufructCap   — if I hold the active cap
escrow.governanceCap; // GovernanceCap — if I hold the gov cap
escrow.earningsInbox; // EarningsInbox — if I hold the earnings inbox
escrow.canRent / escrow.canBorrow / escrow.canGovern; // sugar over "do I hold X here?"
```

This keeps the UI ergonomics ("what can *I* do here?") while being honest that
the answer is *possession*, resolved by an owned-objects lookup, not an identity
the SDK assumes.

## Reads: handle-snapshot vs reader-live

There are two ways to read, and they divide the labour cleanly:

| | `escrow.*` getters | `escrow.reader.*` |
|---|---|---|
| Freshness | **snapshot** at the fetch time `t` | **live** — each call hits the chain |
| Cost | one batched fetch, then sync getters | one round-trip per call |
| Surface | the curated hot fields | the ~80 drift-free kernel views |
| After a write | **stale** — re-resolve with `u.escrow(id)` | already current — just call again |

The handle's getters (`escrow.status`, `escrow.floorPrice`, `escrow.accruedCredit`,
…) are a **coherent photograph** taken in a single fetch: every field agrees on
the same `t`, and they're plain sync reads. That's what you want to render a view.
But a photograph ages — after any write the getters describe the *old* state, and
you get a fresh photo by re-resolving the handle.

The `Reader` is the **live probe**. It hangs straight off the handle —
`const reader = escrow.reader` — with **no re-wiring**: `packageId`, `escrowId`,
and the type arguments were already resolved when the handle was built. Every
`reader.*` call is its own round-trip, so the *same* `reader` object answers
before *and* after a write, no re-resolve needed.

So the two layers compose with zero seams — a read before a high-level write and
after it differs, because the Reader sees what the write did:

```ts
const { escrow, governanceCap } = await u.integrate({ asset, coin, market });
const reader = escrow.reader; // live kernel views, straight off the handle

const before = (await reader.restPrice()).priceMist;        // 10_000_000n
await governanceCap.updateMarket(escrow, { restPrice: COIN(0.025) }); // high-level write
const after = (await reader.restPrice()).priceMist;         // 25_000_000n — same `reader`
```

This holds across every write verb — a `rent()` flips `reader.isOccupied()`
`false→true` and sets `reader.activeUsufructCapId()`; `applyPendingTransitionStates()`
clears it again. (Live proof: `scripts/reader-compose.ts`, `npm run compose`.)

One subtlety worth knowing: the Reader shows **real chain state, not a
lazily-computed view**. After a tenure lapses but *before* you apply the
transition, `reader.activeUsufructCapId()` still returns the sitting cap — the
chain hasn't settled yet. It's the high-level `applyPendingTransitionStates()`
write that materializes the transition. Both layers agree on the protocol's lazy
semantics: nothing settles until a transaction touches the escrow.

**Rule of thumb:** render from the handle snapshot; observe a write's effect, or
reach a view the handle doesn't surface, through `escrow.reader`.

## Renting: the decision is the amount, not the coin

The coin is **fixed at `integrate`** (a `phantom CoinType`, immutable). So at
rent time the renter does not *choose* a coin — the escrow already dictates it.
The one real decision is the **amount**: pay the floor, or overpay (the surplus
becomes stake — more credit/time). `rent` reflects exactly that:

```ts
escrow.rent({ tenures: 1 })                       // pay the floor (floorPrice × tenures)
escrow.rent({ tenures: 1, pay: escrow.floorPrice.scale(1.5) }) // overpay 50% → extra stake
```

`pay` is optional and defaults to the floor. The coin is never named — it's the
escrow's own, drawn from your balance (`tx.gas` for SUI, otherwise select/merge/
split). There is no `payment`/coin-sourcer: that conflated *which coin* (the
escrow owns that) with *how much* (the only thing you decide).

**To overpay you must first know the floor.** That asymmetry is honest, and the
API leans into it: read `escrow.floorPrice` (a `Price`) and derive the amount
*from it* with `Price` arithmetic — `floor.scale(1.5)` (50% over) or
`floor.plus(escrow.coin(0.005))` (a fixed tip) — so the overpay is tied to the
live floor, never a stale literal. `escrow.coin` is the escrow's coin as a tag,
there to express amounts in it. (Live: `scripts/rent-pricing.ts`, `npm run pricing`.)

This mirrors the genesis side: at `integrate` the coin is a genuine choice, so
it's an explicit parameter; at `rent` it is *not* a choice, so the API doesn't
ask. Same principle as the rest of this document — the surface reflects where each
decision actually lives.

## Why this is the full expression of "resolve, don't hide" (rule #5)

Rule #5: only the global singletons (`Clock`, `ProtocolFeeRef`) are injected;
every owned object stays explicit, as the **receiver** of its call. The
object-centric model is that rule taken to its conclusion: the owned object *is*
the handle, and possession *is* the authority. The old `Governor` bundle was a
residual role-centric assumption (one entity owns cap + inbox) that snuck back in
— this removes it. The kernel was object-centric all along (the Move fns take the
objects independently); only Layer 2 had bundled them.
