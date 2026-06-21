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
| `Escrow` (shared) | `Escrow` | `write.rent`, `write.apply` (permissionless) + reads | `u.nav.escrow(id)` |
| `UsufructCap` | `UsufructCap` | `write.borrow`/`.into`, `write.updateRefundAddress`, `write.burnIfStale`, `write.burn`, **`write.transfer`** | `u.nav.usufructCap(id)` |
| `GovernanceCap` | `GovernanceCap` | `write.updateMarket`/`write.retire`/`write.claim`/`write.extend*`, `write.renounce`, `write.integrateIntoPortfolio`, **`write.transfer`** | `u.nav.governanceCap(id)` |
| `EarningsInbox` | `EarningsInbox` | `read.balance`, `write.collect`, **`write.transfer`** | `u.nav.earningsInbox(id)` |
| `ProtocolFeeInbox` | `ProtocolFeeInbox` | `read.balance`, `write.collect`, **`write.transfer`** | `u.nav.feeInbox()` — singleton, resolved from the `ProtocolFeeRef` (or `u.nav.feeInbox(id)`) |

There is **no `Governor`** handle. `integrate` mints three objects and returns
three independent handles:

```ts
const { escrow, governanceCap, earningsInbox } = await u.write.integrate({ asset, coin, market });
// each is a separate bearer object; they can diverge from here.
```

The per-escrow governance writes name their target escrow (one cap governs a
portfolio): `governanceCap.write.updateMarket(escrow, market)`. Adding a new asset to
the portfolio is the one write that depends on **two** objects — the cap (the
portfolio it joins) and the inbox it pays into — so both are named explicitly:

```ts
await governanceCap.write.integrateIntoPortfolio(asset, coin, market, { earningsInbox: earningsInbox.inboxId });
```

The `coin` is a parameter of `integrate` / `integrateIntoPortfolio`, **never a
`Market` field**: in Move it's a `phantom CoinType` baked into the escrow's type
at genesis and immutable thereafter. A `Market` is the mutable policy you can
`updateMarket`; the coin is not, so it lives where it's decided once — and a
portfolio may hold escrows of different coins, all paying one inbox.

## `transfer` is first-class — moving the object moves the role

Every bearer handle has `write.transfer(to)` (`tx.transferObjects([tx.object(id)], to)`,
signed by the current holder). This is the whole point, not an afterthought:

```ts
await governanceCap.write.transfer(treasury);   // hand off governance
await earningsInbox.write.transfer(treasury);   // route income elsewhere
await usufructCap.write.transfer(buyer);        // sell the right of use
```

After the transfer, the new holder governs/collects/uses; the old holder's
handle no longer works (the chain rejects a `tx.object(id)` it doesn't own →
`NotGovernor` / not-owned).

## Who transfers the produced objects — the high-level / primitives line

The functions that mint objects return them **by value** — the protocol does
**not** decide a destination:

```move
public fun integrate<...>(...): (GovernanceCap, EarningsInbox)  // returned
public fun rent<...>(...): UsufructCap                          // returned
public fun borrow_asset<...>(...): (Asset, AssetReceipt)        // returned
```

In Move a returned object *must* be consumed by the caller — transferred, wrapped,
or passed on — or the transaction won't build. So the destination is a PTB
decision, and that is exactly where the two layers divide:

- **Primitives / kernel actions** (`src/actions`, `u.primitives`) return the
  object as a **PTB value** for you to compose: transfer it elsewhere, hand it
  straight into another call, batch it, sponsor it. Nothing is implied.
- **High-level handles** make the common choice for you — they append
  `tx.transferObjects([minted], sender)` so the cap lands in your wallet:

  ```ts
  // u.write.integrate → tx.transferObjects([GovernanceCap, EarningsInbox], sender)
  // escrow.write.rent → tx.transferObjects([UsufructCap], sender)
  ```

So "the cap arrives in my wallet" is a **high-level convenience, not protocol
behaviour**. The same by-value return is what makes everything in this document
possible at the primitive layer: a secondary-market `transfer(to)` sends it to a
buyer instead; the asset-agnostic flow feeds a `rent`-minted `UsufructCap`
straight into an `integrate` (the SDK's default transfer just makes that two txs
instead of one); `write.borrow.into` composes the borrowed asset mid-PTB. The high-level
picks the default destination; the primitives hand you the value and let you
decide. Rule #5 again — the object is explicit, and someone (you, or the SDK on
your behalf) always says where it goes.

## Discovery is object-centric — you govern by the cap, not by an address

Finding "the escrows I govern" is not an address query. Governance is possession
of the `GovernanceCap`, and that cap is `key + store` — transferable. So the
governor of an escrow is *whoever holds its cap now*, which may differ from the
address that integrated it.

And there is a sharp on-chain fact behind this: **the `GovernanceCap` does not
store which escrows it governs.** Its Move struct is just `{ id }`. That cap→escrow
link is **not on-chain at all** — it lives only in the event log
(`AssetIntegrated` carries both `governance_cap_id` and `escrow_id`). So the two
ways to discover escrows are genuinely different:

| Door | Means | Source |
|---|---|---|
| `u.inspect.integratedBy(addr)` | who *brought it into being* (history) | `AssetIntegrated.governor_address == addr` |
| `u.inspect.governedByCap(capId)` | what *this cap* governs (its portfolio) | `AssetIntegrated.governance_cap_id == capId` |
| `u.inspect.governedBy(addr)` | what *addr* governs now (possession) | `addr`'s owned `GovernanceCap`s ∩ the event log |

`u.inspect.governedByCap(capId)` is the **purest** object-centric query: the cap *is*
the governor, so you ask the cap what it governs — keyed on the object, not a
holder. It's also a method on the handle: `governanceCap.inspect.escrows()` (the cap
answering for itself). One cap can govern a whole **portfolio** — every escrow
under it is returned.

`u.inspect.governedBy(addr)` is the holder-convenience built on it: it lists the caps
`addr` owns *right now* and unions their escrows (intersecting `AssetIntegrated`
events — the only place the cap→escrow link exists). It **follows the cap** — it
includes escrows whose cap was transferred *to* `addr`, and excludes ones whose
cap they gave *away*.

The same object-centric move extends to the **inboxes** — `AssetIntegrated` also
sets `earnings_inbox_id` and `fee_inbox_id`, so an inbox can answer which escrows
feed it: `earningsInbox.inspect.escrowsPushingMessages()` is the governor's portfolio
paying into that inbox; on the `ProtocolFeeInbox` (the deployment singleton) it's
every escrow of the protocol. Same pattern every time — the object holds an id in
the event log, so the object answers for itself.

The `UsufructCap` is the one **asymmetric** case, and it's instructive. Unlike the
`GovernanceCap` (`{ id }`), the cap *stores* its escrow on-chain:

```move
public struct UsufructCap has key, store { id: UID, escrow_identity: EscrowIdentity }
```

(It must — `borrow` proves the cap belongs to the escrow.) So cap→escrow needs no
events: `usufructCap.nav.escrow()` reads it off the object, and `u.inspect.rentedBy(addr)`
just decodes `addr`'s owned caps. The reverse — every cap an escrow ever minted —
is *not* on the cap or the escrow; it lives in `UsufructCapMinted` events, so the
escrow answers from there: `escrow.inspect.usufructCaps()` (the roster of renters and
bidders, active / pending / long-burned).

The rule, stated once: **a relationship is queryable from whichever object stores
the link** — on-chain when an object holds the id (the cap's escrow), in the event
log otherwise (everything keyed by `AssetIntegrated` / `UsufructCapMinted`). The
high-level just puts the question on the object that can answer it.

And the per-escrow *timeline* is the same axis turned sideways: `escrow.inspect.history()`
returns the escrow's whole lifecycle as ordered, typed `HistoryEvent`s (integration,
policy, rentals, bids, displacements, settlements, governance, teardown) — every
escrow-keyed event, decoded and merged. Because GraphQL can't filter by a payload
field, it scans each event type and keeps this escrow's; on a busy package, bound it
with `afterCheckpoint` (the escrow's events all postdate its integration).

Finally, to *act* on what happens, `escrow.react.watch(onChange)` runs a callback with a
fresh snapshot on every on-chain change, and `escrow.react.waitFor(e => e.isChallenged)`
resolves the moment a state arrives — *waiting for an event* expressed as the state
it produces. That's the keeper loop: wait for a challenge and settle the handover,
wait for expiry and apply, counter-bid on displacement.

It's **server-push, not polling** — and still decode-free. The trick is to split
the gRPC checkpoint firehose from the decode: the firehose signals only
`object_id` + `version` (no content, no BCS, no asset schema), and on each version
change we re-resolve the *decode-free* handle. So you get push latency without the
`EscrowState` decode that the raw `source.subscribe` does (which would need a
schema). The stream primes off its first live checkpoint to close the
subscribe-setup gap, and falls back to version-polling only when no gRPC client is
configured.

And to react to a *specific event* with its data, `escrow.react.on('BidPlaced', e => …)`
(or `escrow.react.onEvents`) is the push twin of `inspect.history()`: the same checkpoint
firehose, but with events in the mask — each one decoded by the **same registry**
History uses (events are self-contained structs, no asset schema) and filtered to
this escrow. `inspect.history()` reads the typed events in *pull*; `escrow.react.on` delivers the
same typed events in *push*. That closes the loop — state and events, snapshot and
stream, all object-centric.

Both watches come in two shapes — a continuous callback and a one-shot promise —
and they line up: `react.watch`/`react.waitFor` for state, `react.on`/`react.next` for events. So
`await escrow.react.next('BidPlaced')` is `react.waitFor` for events — no Promise to wire by
hand around `react.on`.

The difference is real and observable: on testnet our address had **integrated
224** escrows but **governs 196** — the 28-escrow gap is exactly the caps it
transferred away (the secondary-market flow). Governance left with the object.

Both doors return decode-free `EscrowListing`s (every field straight from the
event — no per-escrow fetch), each with an `.escrow()` back-edge to the full
handle. This is the third read axis — state (handles + `Reader`), and now events —
sitting on the indexer's typed event stream, same primitives/high-level line as
everything else.

## The Escrow: identities (data) vs holdings (what *I* hold)

The escrow knows, as plain data, **which objects relate to it** — regardless of
who holds them:

```ts
escrow.governanceCapId;     // the cap that governs this escrow
escrow.earningsInboxId;     // the inbox it pays into
escrow.feeInboxId;          // the protocol fee inbox
escrow.activeUsufructCapId; // the current right-of-use cap (or null)
```

And it hands you **every related object as a ready handle** — reached via `nav`,
no possession required. Each is a lazy reference; ask any of them, act on any of them
(a write just needs you to actually hold it):

```ts
await escrow.nav.activeCap();     // UsufructCap | null — the current seat (read its state, or borrow if yours)
await escrow.nav.pendingCap();    // UsufructCap | null — the challenger's seat
await escrow.nav.governanceCap(); // GovernanceCap      — read.governs(escrow), write.updateMarket(escrow), …
await escrow.nav.earningsInbox(); // EarningsInbox      — read.balance, write.collect
await escrow.nav.feeInbox();      // ProtocolFeeInbox
```

**Possession is a separate axis** — "what can *I* do here?", honest that
the answer is an owned-objects lookup, not an identity the SDK assumes. The booleans
live under `escrow.read.role()`:

```ts
(await escrow.read.role()).canRent;       // I can rent (signer set, not retired)
(await escrow.read.role()).canBorrow;     // I hold the active UsufructCap
(await escrow.read.role()).canGovern;     // I hold the GovernanceCap
(await escrow.read.role()).holdsEarnings; // I hold the EarningsInbox
```

So the counterpart objects are always there to ask (reached via `nav.*()`); possession
only governs whether a **write** on them succeeds. One model — no handle that's null
just because you don't hold it.

## Reads: curated views vs reader-live

There are two ways to read, and they divide the labour cleanly:

| | `escrow.read.*` methods | `u.primitives.reader(target).*` |
|---|---|---|
| Freshness | **live** — each call hits the chain | **live** — each call hits the chain |
| Cost | one round-trip per call | one round-trip per call |
| Surface | the curated hot fields | the ~80 drift-free kernel views |
| Coherence | per-call; `escrow.read.snapshot()` for one cross-section at `t` | per-call |

The handle's reads (`(await escrow.read.assetState()).kind`, `await escrow.read.floorPrice()`,
`await escrow.read.expiresAt()`, …) are live `await`-ed methods — each call hits the
chain, so it always reflects the latest state. When you need a **coherent cross-section**
— every field agreeing on the same `t`, to render a view — take one with
`escrow.read.snapshot()`. There is no fetch-time photograph: the handle is a lazy
reference, so reads describe the chain as it is when you ask.

The `Reader` is the **live probe** over the full kernel surface. It hangs straight off
the root — `const reader = u.primitives.reader(escrow)` — with **no re-wiring**:
`packageId`, `escrowId`, and the type arguments come from the handle. Every
`reader.*` call is its own round-trip, so the *same* `reader` object answers
before *and* after a write, no re-resolve needed.

So the two layers compose with zero seams — a read before a high-level write and
after it differs, because the Reader sees what the write did:

```ts
const { escrow, governanceCap } = await u.write.integrate({ asset, coin, market });
const reader = u.primitives.reader(escrow); // live kernel views, off the handle's target

const before = (await reader.restPrice()).priceMist;        // 10_000_000n
await governanceCap.write.updateMarket(escrow, { restPrice: COIN(0.025) }); // high-level write
const after = (await reader.restPrice()).priceMist;         // 25_000_000n — same `reader`
```

This holds across every write verb — a `write.rent()` flips `reader.isOccupied()`
`false→true` and sets `reader.activeUsufructCapId()`; `write.applyPendingTransitionStates()`
clears it again. (Live proof: `scripts/reader-compose.ts`, `npm run compose`.)

One subtlety worth knowing: the Reader shows **real chain state, not a
lazily-computed view**. After a tenure lapses but *before* you apply the
transition, `reader.activeUsufructCapId()` still returns the sitting cap — the
chain hasn't settled yet. It's the high-level `write.applyPendingTransitionStates()`
write that materializes the transition. Both layers agree on the protocol's lazy
semantics: nothing settles until a transaction touches the escrow.

**Rule of thumb:** render from the curated `escrow.read.*` (a coherent cross-section
via `escrow.read.snapshot()`); reach a view the handle doesn't surface through
`u.primitives.reader(escrow)`.

### One read shape: every handle is a lazy reference

There's a deliberate symmetry across the handles, and it's worth naming. **Every**
handle — the `Escrow` from `u.nav.escrow(id)`, and `UsufructCap`, `GovernanceCap`,
the inboxes reached via `escrow.nav.*()` — is a lightweight **reference** built with
no IO (even `await escrow.nav.activeCap()` is constructed from ids already in hand),
so its reads are **on demand**:

```ts
await escrow.read.floorPrice();              // live — reads when asked
await (await escrow.nav.activeCap()).read.state(); // live — the cap reads when asked
await (await escrow.nav.earningsInbox()).read.balance();
```

All are "ask the object," and the shape is the same: a live `await`-ed read off a
lazy reference. There is no eager-fetch entry handle and no fetch-time photograph —
when you need a coherent cross-section at one `t`, take it explicitly with
`escrow.read.snapshot()`. The symmetry is by design: nothing is fetched until asked.

## Renting: the decision is the amount, not the coin

The coin is **fixed at `integrate`** (a `phantom CoinType`, immutable). So at
rent time the renter does not *choose* a coin — the escrow already dictates it.
The one real decision is the **amount**: pay the floor, or overpay (the surplus
becomes stake — more credit/time). `rent` reflects exactly that:

```ts
escrow.write.rent({ tenures: 1 })                       // pay the floor (floorPrice × tenures)
escrow.write.rent({ tenures: 1, pay: (await escrow.read.floorPrice()).scale(1.5) }) // overpay 50% → extra stake
```

`pay` is optional and defaults to the floor. The coin is never named — it's the
escrow's own, drawn from your balance (`tx.gas` for SUI, otherwise select/merge/
split). There is no `payment`/coin-sourcer: that conflated *which coin* (the
escrow owns that) with *how much* (the only thing you decide).

**To overpay you must first know the floor.** That asymmetry is honest, and the
API leans into it: read `await escrow.read.floorPrice()` (a `Price`) and derive the amount
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

## The three axes — state, writes, events

Everything above composes into three axes, and that's the whole surface. (For the
developer-facing framing as four verbs — **read · write · inspect · react** — see
[Read · Write · Inspect · React](./read-write-inspect-react.md).)

1. **State** — *the chain as it is now.* The `Escrow` handle's `read.*` (live curated
   views, `escrow.read.snapshot()` for a coherent cross-section) and
   `u.primitives.reader(escrow)` (live drift-free views). `u.nav.escrow(id)`,
   `(await escrow.read.assetState()).kind`, `await escrow.read.floorPrice()`,
   `escrow.read.role()`.
2. **Writes** — *change it.* The capability handles' methods, each on the object
   that authorizes it: `escrow.write.rent`, `usufructCap.write.borrow`, `governanceCap.write.updateMarket`,
   `inbox.write.collect`, `write.transfer`. Authority is possession; nothing is hidden.
3. **Events** — *what happened, and what happens.* Discovery (find escrows by
   relationship), History (an escrow's lifecycle), Watch (react live).

The events axis is itself split by delivery, over the **same typed events**:

| | Pull | Push |
|---|---|---|
| Find | `u.inspect.governedBy` / `u.inspect.byAssetType` … (GraphQL) | — |
| Lifecycle | `escrow.inspect.history()` (GraphQL, paginated) | `escrow.react.on('BidPlaced', …)` / `react.onEvents` (gRPC firehose) |
| State change | re-`u.nav.escrow(id)` | `escrow.react.watch` / `react.waitFor` (gRPC firehose) |

**`escrow.react.on` is the piece that closes the three axes**: it's *the same typed
events of `inspect.history()`, but pushed live over the firehose.* History reads them in
pull (paginated GraphQL); `escrow.react.on` streams them in push (gRPC checkpoints) —
one decoder, one set of events, two deliveries. With it the loop is whole: you can
**read** the chain (state), **write** to it (the actions), **inspect** what it did
(history, pull), and **react** to what it does (watch + on, push) — every one keyed
on the objects, decode-free, the object answering for itself.
