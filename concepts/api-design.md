# API design — drift-zero, object-centric, navigable

> The whole SDK is **one shape, repeated**, resting on four design pillars. This
> doc is the model; [`write-model.md`](./write-model.md) is how writes execute,
> [`borrow.md`](./borrow.md) is the borrow bracket, and
> [`primitives.md`](./primitives.md) is the layer the high-level composes from.

## The four pillars

1. **Drift-zero.** Every `read` is the deployed bytecode's *own* answer — the
   `Reader` evaluates the on-chain Move views via `simulateTransaction` (each view
   takes `now_ms`, so you can read at any `t`). The core never re-derives protocol
   logic in TypeScript, so it **cannot drift** from the contract. Off-chain
   re-derivation (simulation, what-if) is the opt-in mirror `@usufruct-protocol/sim`,
   golden-tested against this core.
2. **Object-centric.** A "governor", "usufructuary", "earnings collector" is not an
   identity the SDK tracks — it is *whoever currently holds the corresponding
   object*. Authority is **possession** of a bearer object (`key + store`), not an
   ACL. The objects move; the roles move with them.
3. **Navigable.** Objects form a graph and you walk it with `nav` — an escrow → its
   seats / its governance cap / its inbox; a cap → its escrow. You hold one handle
   and reach the rest, no ids to thread by hand.
4. **Five verbs, fractal.** Every object is its **identity** (the object's name)
   plus **`nav · read · inspect · react · write`** — and the *same* five sit on the
   global root `u` and on every handle. Learn the shape once; it repeats at every
   scale.

```
nav     → where      · walk to a related object   · escrow.nav.activeCap() · cap.nav.escrow()
read    → what is     · live on-chain state         · escrow.read.assetState() · cap.read.state()
inspect → what happened· the event log, pulled       · escrow.inspect.history() · u.inspect.governedBy()
react   → what happens · the event log, pushed       · escrow.react.watch() · escrow.react.on()
write   → what I change· a transaction (a Plan)      · rent · borrow · updateMarket · collect · integrate
```

`read`/`write` are on-chain **state** (read it / change it with a tx); `inspect`/
`react` are the **event log** (pull what happened / push what happens); `nav` is the
**graph** (the edges). Every verb is *object-centric* (ask the object you hold) and
*decode-free* (no asset schema needed).

## The one rule: flat ⟺ a name

A property is **flat** (a plain field, not a verb) only when it is **zero-IO and
immutable** — i.e. the object's *name*. Everything that touches the chain, or could
change, is a verb (always `await`-ed):

| Object | Flat (identity) | Everything else |
|---|---|---|
| `Escrow` | `id`, `assetType`, `coinType`, `coin` | `nav` · `read` · `inspect` · `react` · `write` |
| `UsufructCap` | `id`, `escrowId`, `receipt` | `nav` · `read` · `inspect` · `react` · `write` |
| `GovernanceCap` | `capId` | `read` · `inspect` · `react` · `write` |
| `EarningsInbox` / `ProtocolFeeInbox` | `inboxId` | `read` · `inspect` · `react` · `write` |
| `u` (root) | `address` | `nav` · `read` · `inspect` · `react` · `write` |

There is **no fetch-time photo**. The handle holds no state; each `read.*` asks the
deployed views *now*, so nothing it exposes can go stale. Resolving a handle
(`await u.nav.escrow(id)`) fetches only what identity needs — the type args and coin
metadata — and returns immediately; the verbs do the rest, lazily.

## The grid — five verbs on every object

Pick the object you hold, then `.nav` / `.read` / `.inspect` / `.react` / `.write`
*on it*. The root `u` only **resolves** the first handle (`u.nav.escrow(id)`,
`u.nav.usufructCap(id)`, `u.write.integrate()`).

| | **nav** | **read** | **inspect** (pull) | **react** (push) | **write** |
|---|---|---|---|---|---|
| **Escrow** | `activeCap()`, `pendingCap()`, `governanceCap()`, `earningsInbox()`, `feeInbox()` | `assetState()`, `floorPrice()`, `market()`, `cycle()`, the 60+ views… | `history()`, `priceTimeline()`, `creditHistory()`, `tenancies()`, `usufructCaps()` | `watch()`/`waitFor()`, `on()`/`next()`/`onEvents` | `rent()`, `applyPendingTransitionStates()` |
| **UsufructCap** | `escrow()` | `state()`, `isActive/isPending/isStale()` | `history()`, `statement()` | `watch()`, `waitFor()` | `borrow()`, `burn()`, `burnIfStale()`, `updateRefundAddress()`, `transfer()` |
| **GovernanceCap** | — | `governs(escrow)` | `escrows()`, `revenueByEscrow()` | `watch()` (portfolio) | `updateMarket()`, `retire()`, `claim()`, `extend…()`, `renounceGovernance()`, `transfer()`, `integrateIntoPortfolio()` |
| **EarningsInbox** / **ProtocolFeeInbox** | — | `balance()` | `history()`, `totals()`, `escrowsPushingMessages()` | `watch()` (new income) | `collect()`, `transfer()` |
| **`u`** (root) | `escrow()`, `escrows()`, `usufructCap()`, `governanceCap()`, `earningsInbox()`, `feeInbox()` | `protocolFeeBps()`, `bpsDenominator()` | `integratedBy()`, `governedBy()`, `rentedBy()`, `governedByCap()`, `byAssetType()`, `byCoinType()` | `watchMany()` | `integrate()` |

Two notes on the shape:
- `nav` exists where an object has a **single edge** to follow (an escrow's seats and
  counterpart objects; a cap's escrow; the root's "open this id"). `GovernanceCap` and
  the inboxes relate to escrows through a **collection**, so that lives under
  `inspect` (`governanceCap.inspect.escrows()`), not `nav`.
- **Possession is not a gate on the handles.** Anyone can resolve any object's handle
  and `read`/`inspect` it; a `write` only *succeeds* if you actually hold the bearer
  object (else the tx aborts).

## Possession is the role

The protocol has four capability objects, all `key + store` — so `store` means
anyone can `public_transfer` them, and Move makes the authority **possession
itself**: to produce a `&GovernanceCap` / `&mut EarningsInbox` / `&UsufructCap`
inside a PTB you must pass `tx.object(id)`, which only succeeds if the *signer owns
it*.

| Object | Created at | Holding it lets you… |
|---|---|---|
| `GovernanceCap` | `integrate` | **govern** — `updateMarket`, `retire`, `claim`, `extend*`, `integrateIntoPortfolio` |
| `EarningsInbox` | `integrate` | **collect earnings** (the 90% governor cut) — maybe a treasury, not the governor |
| `UsufructCap` | `rent` | **use** — `borrow` the asset; a tradable bearer instrument |
| `ProtocolFeeInbox` | deploy | **collect protocol fees** — the deployment singleton |

The role is **emergent from possession**, never an identity the SDK stores. So:

- There is **no `Governor` handle.** `integrate` mints three *independent* objects —
  `{ escrow, governanceCap, earningsInbox }` — that can diverge: sell the governance,
  point earnings at a treasury, run a secondary market for rights of use.
- **`transfer` is first-class on every bearer** — moving the object moves the role:
  ```ts
  await governanceCap.write.transfer(treasury);  // hand off governance
  await earningsInbox.write.transfer(treasury);  // route income elsewhere
  await usufructCap.write.transfer(buyer);       // sell the right of use
  ```
  After the transfer the old holder's handle no longer authorizes writes (the chain
  rejects a `tx.object(id)` it doesn't own → `NotGovernor` / not-owned).
- **There is no `role()` composite.** Authority is a plain owned-objects question, so
  you ask the canonical views: *can I rent?* `!(await escrow.read.isRetired())`; *do I
  hold the active seat?* `await cap.read.isActive()`; *what do I govern / rent?*
  `await u.inspect.governedBy(me)` / `await u.inspect.rentedBy(me)`.

The escrow exposes **every related object as a ready handle** (via `nav`), no
possession required — possession only governs whether a *write* on it succeeds.
There is no handle that's null just because you don't hold it.

---

## nav — walk the graph

`nav` returns a *related handle*, not state. Immutable edges (a cap's escrow) and
time-varying edges (an escrow's active seat) are both `await`-ed, because resolving a
handle is IO:

```ts
const escrow = await u.nav.escrow(id);          // the root opens the first handle
const seat   = await escrow.nav.activeCap();    // edge: the current seat (or null)
const gov    = await escrow.nav.governanceCap();// edge: who governs it
const back   = await seat?.nav.escrow();        // back-edge: cap → its escrow
const inbox  = await u.nav.feeInbox();           // the deployment's fee pool (id-less singleton)
```

## read — the chain as it is now

`read` is the deployed views, live. The bulk is **auto-rendered** from the protocol's
view surface (mist→`Price` in the escrow's own coin, ms-timestamp→`Date`,
ms-duration/count→`number`); a few **composites** sit alongside:

```ts
const s = await escrow.read.assetState();   // discriminated union — narrows to the phase
if (s.kind === 'demand') {                  // 'idle' | 'occupied' | 'demand' | 'descent' | 'retired'
  s.challenger; s.bid; s.handoverExpiresAt; // each phase carries its own data
}
await escrow.read.floorPrice();             // a Price, rendered in the escrow's coin
await escrow.read.market();                 // the full policy (rest price, tenure, curves…)
await escrow.read.creditCurve();            // the CURRENT tenure's curve, sampled live
await seat?.read.state();                   // the seat's economics — ask the cap itself
await inbox.read.balance();                 // uncollected income, per coin
```

**Drift-zero:** every read is `simulateTransaction` over the on-chain views — the
SDK can't drift from the contract, it only renders the bytecode's answer. The raw,
un-rendered kernel reader (policy unions, exact bigints) is **not** on the handle —
reach it at the root: `u.primitives.reader(target)` (see [`primitives.md`](./primitives.md)).

## write — make it different

```ts
await escrow.write.rent({ tenures: 1 }).send();             // pay the floor; `pay` to overpay → stake
await cap.write.borrow((asset, tx) => { /* your PTB; return is appended */ }).send();
await gov.write.updateMarket(escrow, { restPrice: escrow.coin(0.02) }).send();
await inbox.write.collect().send();                         // 90% governor cut, partitioned by coin
await gov.write.transfer(treasury).send();                  // move the object → move the role
await u.write.integrate({ asset, coin, market }).send();    // genesis: mint escrow + cap + inbox
```

Each write lives on the object that authorizes it, and every write is a **`Plan`**:
`.send()` builds, signs, and decodes in one call; `.build(tx, sender)` lets you drive
the transaction yourself (compose many, mix raw commands, sign with a
wallet/Ledger/sponsor). Nothing touches the chain until `.send()` — reads read,
writes wait. See [`write-model.md`](./write-model.md). `borrow` hands you the asset
mid-PTB to compose with — see [`borrow.md`](./borrow.md).

## inspect — what happened (pull)

Every object answers two questions over the same typed, decode-free event log: *which
escrows relate to me* (discovery) and *what happened* (history).

```ts
await gov.inspect.escrows();                   // discovery: this cap's portfolio
await inbox.inspect.escrowsPushingMessages();  // who pays into this inbox
await escrow.inspect.history();                // the escrow's whole lifecycle, time-ordered
await cap.inspect.statement();                 // the renter's P&L: paid / consumed / refunded
await escrow.inspect.tenancies();              // the occupancy ledger, per-tenancy economics
await u.inspect.governedBy(addr);              // escrows this address governs now
await u.inspect.byCoinType(coinType);          // escrows priced in this coin
```

`escrow.inspect.history()` walks the escrow's own transactions (`affectedObject`) —
O(its lifecycle), not O(package history). The curve reconstructions
(`priceTimeline`/`creditHistory`/`tenancies`) replay that log into the curves the
chain computed, drift-zero. **Needs a `graphql` endpoint** (defaults from the
network; pass `graphql: false` to disable).

### Discovery is object-centric — you govern by the cap, not by an address

A relationship is queryable **from whichever object stores the link** — on-chain when
an object holds the id, in the event log otherwise. The `GovernanceCap` struct is just
`{ id }` (it does *not* store its escrows), so cap→escrow lives only in the
`AssetIntegrated` event:

| Door | Means | Source |
|---|---|---|
| `u.inspect.integratedBy(addr)` | who *brought it into being* | `AssetIntegrated.governor_address == addr` |
| `u.inspect.governedByCap(capId)` | what *this cap* governs (its portfolio) | `AssetIntegrated.governance_cap_id == capId` |
| `u.inspect.governedBy(addr)` | what *addr* governs **now** | `addr`'s owned `GovernanceCap`s ∩ the event log |

`governedBy` *follows the cap* — it includes escrows whose cap was transferred *to*
`addr`, excludes ones given away (on testnet our address integrated 224 but governs
196 — the 28-escrow gap is exactly the caps it sold). The `UsufructCap` is the
asymmetric case: it *stores* its escrow on-chain (`borrow` must prove the link), so
`usufructCap.nav.escrow()` reads it off the object and `u.inspect.rentedBy(addr)` just
decodes owned caps.

## react — what happens (push)

Don't poll — subscribe over the gRPC checkpoint firehose. React to a **state**
arriving or a **typed event** with its data, continuously or one-shot:

```ts
const stop = escrow.react.watch(e => render(e));            // state: each change → fresh handle
escrow.react.on('BidPlaced', ev => counterBid(ev.data));    // events: typed, by kind
await escrow.react.waitFor(async e =>                       // one-shot state (async predicate)
  (await e.read.assetState()).kind === 'demand');
await escrow.react.next('BidPlaced', { timeoutMs: 120_000 });// one-shot event
cap.react.watch(seat => render(seat));                      // the renter watches THEIR seat
u.react.watchMany(ids, e => dashboard(e));                  // many escrows, one firehose
```

|        | continuous (callback) | one-shot (promise) |
|--------|---|---|
| **state** | `escrow.react.watch(cb)` / `cap.react.watch(cb)` | `escrow.react.waitFor(pred)` / `cap.react.waitFor(pred)` |
| **events** | `escrow.react.on(kind, cb)` / `onEvents`, `inbox.react.watch(cb)` | `escrow.react.next(kind)` / `nextEvent` |

`waitFor` resolves to the **handle** (so you can act on it), and its predicate is
**async over the handle**. Filter not just by event *type* but by a **field value** —
`where` is a predicate on the decoded event (gRPC can't filter a payload server-side,
but we decode every event anyway, so `where` is free).

## inspect and react are the same events

`escrow.inspect.history()` and `escrow.react.on(...)` decode the **same typed
events** — one paginated over GraphQL (pull), one streamed over the gRPC firehose
(push). One event model, two deliveries. That closes the loop:

```
nav     → a related handle  · the object graph        · escrow.nav.activeCap() · cap.nav.escrow() · u.nav.escrow(id)
read    → state, now        · Reader (drift-zero)     · escrow.read.* · cap.read.state() · inbox.read.balance()
inspect → events, pull      · Source.query/events     · escrow.inspect.history · gov.inspect.escrows · u.inspect.governedBy
react   → events, push      · Source.subscribe (gRPC) · escrow.react.watch/on · cap.react.watch · inbox.react.watch
write   → a transaction     · Action.toPtb            · rent · borrow · updateMarket · collect · transfer · integrate
```

Identity + five verbs, on the object you hold (and on `u`, the protocol whole), over a
core that cannot drift. Same shape at every scale — that's the whole API.
