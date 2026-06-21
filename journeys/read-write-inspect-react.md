# Nav · Read · Inspect · React · Write — the fractal, navigable API

> The whole SDK is **one shape, repeated**: every object is its **identity**
> (the object's name) plus five verbs —
>
> - **nav** → *where* (walk to a related object)
> - **read** → what *is* (live on-chain state)
> - **inspect** → what *happened* (the event log, pulled)
> - **react** → what *happens* (the event log, pushed)
> - **write** → what I *change* (a transaction)
>
> `read`/`write` are on-chain **state** (read it / change it with a tx); `inspect`/
> `react` are the **event log** (pull what happened / push what happens); `nav` is
> the **graph** (the edges between objects). Every verb is *object-centric* — you ask
> the object you hold, it answers — and *decode-free* (no asset schema).
>
> The shape is **fractal**: the same five verbs sit on the global root `u` (the
> protocol seen whole) and on every object handle. See
> [the object model](./object-model.md) for *why* possession is the role.

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
| **Escrow** | `activeCap()`, `pendingCap()`, `governanceCap()`, `earningsInbox()`, `feeInbox()` | `assetState()`, `floorPrice()`, `market()`, `cycle()`, `role()`, the 60+ views… | `history()`, `priceTimeline()`, `creditHistory()`, `tenancies()`, `usufructCaps()` | `watch()`/`waitFor()`, `on()`/`next()`/`onEvents` | `rent()`, `applyPendingTransitionStates()` |
| **UsufructCap** | `escrow()` | `state()`, `isActive/isPending/isStale()` | `history()`, `statement()` | `watch()`, `waitFor()` | `borrow()`, `burn()`, `burnIfStale()`, `updateRefundAddress()`, `transfer()` |
| **GovernanceCap** | — | `governs(escrow)` | `escrows()`, `revenueByEscrow()` | `watch()` (portfolio) | `updateMarket()`, `retire()`, `claim()`, `extend…()`, `renounce()`, `transfer()`, `integrateIntoPortfolio()` |
| **EarningsInbox** / **ProtocolFeeInbox** | — | `balance()` | `history()`, `totals()`, `escrowsPushingMessages()` | `watch()` (new income) | `collect()`, `transfer()` |
| **`u`** (root) | `escrow()`, `escrows()`, `usufructCap()`, `governanceCap()`, `earningsInbox()`, `feeInbox()` | `protocolFeeBps()`, `bpsDenominator()` | `integratedBy()`, `governedBy()`, `rentedBy()`, `governedByCap()`, `byAssetType()`, `byCoinType()` | `watchMany()` | `integrate()` |

Two notes on the shape:
- `nav` exists where an object has a **single edge** to follow (an escrow's seats and
  counterpart objects; a cap's escrow; the root's "open this id"). `GovernanceCap` and
  the inboxes relate to escrows through a **collection**, so that lives under
  `inspect` (`governanceCap.inspect.escrows()`), not `nav`.
- **Possession is not a gate on the handles.** Anyone can resolve any object's handle
  and `read`/`inspect` it; a `write` only *succeeds* if you actually hold the bearer
  object (else the tx aborts). To ask "can I?", read `escrow.read.role()`.

---

## nav — walk the graph

`nav` returns a *related handle*, not state — the edges between objects. Immutable
edges (a cap's escrow) and time-varying edges (an escrow's active seat) are both
`await`-ed, because resolving a handle is IO:

```ts
const escrow = await u.nav.escrow(id);          // the root opens the first handle
const seat   = await escrow.nav.activeCap();    // edge: the current seat (or null)
const gov    = await escrow.nav.governanceCap();// edge: who governs it
const back   = await seat?.nav.escrow();        // back-edge: cap → its escrow

// the root is fractal — the same nav, at protocol scope:
const inbox  = await u.nav.feeInbox();          // the deployment's fee pool (by id-less)
const cap    = await u.nav.usufructCap(capId);  // any object, by id
```

## read — the chain as it is now

`read` is the deployed views, live. The bulk is **auto-rendered** from the protocol's
view surface (mist→`Price` in the escrow's own coin, ms-timestamp→`Date`,
ms-duration/count→`number`), so every on-chain view has a home on the object, with no
hand-wiring. A few **composites** sit alongside:

```ts
const s = await escrow.read.assetState();   // discriminated union — narrows to the phase
if (s.kind === 'demand') {                  // 'idle' | 'occupied' | 'demand' | 'descent' | 'retired'
  s.challenger; s.bid; s.handoverExpiresAt; // each phase carries its own data
}

await escrow.read.floorPrice();             // a Price, rendered in the escrow's coin
await escrow.read.market();                 // the full policy (rest price, tenure, curves…)
await escrow.read.role();                   // { canRent, canBorrow, canGovern, holdsEarnings }
await escrow.read.creditCurve();            // the CURRENT tenure's curve, sampled live
await seat?.read.state();                   // the seat's economics — ask the cap itself
await inbox.read.balance();                 // uncollected income, per coin
```

**Drift-zero:** every read is the deployed bytecode's own answer
(`simulateTransaction` over the on-chain views, each taking `now_ms` so you can read
at any `t`), so the SDK can't drift from the contract — the handle only renders it.
For off-chain re-derivation (simulation, what-if), reach for
`@usufruct-protocol/sim`, the opt-in mirror golden-tested against this core.

Need the raw, un-rendered kernel reader (policy unions, exact bigints)? It is **not**
on the handle — reach the escape hatch at the root: `u.primitives.reader(target)`.

## write — make it different

```ts
await escrow.write.rent({ tenures: 1 }).send();             // pay the floor; `pay` to overpay → stake
await cap.write.borrow((asset, tx) => { /* your PTB; return is appended */ }).send();
await gov.write.updateMarket(escrow, { restPrice: escrow.coin(0.02) }).send();
await inbox.write.collect().send();                         // 90% governor cut, partitioned by coin
await gov.write.transfer(treasury).send();                  // move the object → move the role
await u.write.integrate({ asset, coin, market });           // genesis: mint escrow + cap + inbox
```

Each write lives on the object that authorizes it. `transfer` is first-class on every
bearer — moving the object moves the role. Every write is a **`Plan`**: `.send()`
builds, signs, and decodes in one call; `.build(tx, sender)` lets you drive the
transaction yourself (compose many writes, mix raw commands, sign with a
wallet/Ledger/sponsor). Nothing touches the chain until `.send()` — reads read,
writes wait. See [write paths](./write-paths.md).

`borrow` hands you the asset mid-PTB to compose with — variadic
(`cap.write.borrow(a, b, c)` composes recipes in order), a `Plan` like the rest. See
[borrow — composing code around the rented asset](./borrow-composition.md).

## inspect — what happened (pull)

Every object answers two questions over the same typed, decode-free event log:
*which escrows relate to me* (discovery) and *what happened* (history).

```ts
await gov.inspect.escrows();                   // discovery: this cap's portfolio
await inbox.inspect.escrowsPushingMessages();  // who pays into this inbox
await escrow.inspect.history();                // the escrow's whole lifecycle, time-ordered
await cap.inspect.statement();                 // the renter's P&L: paid / consumed / refunded
await escrow.inspect.tenancies();              // the occupancy ledger, per-tenancy economics

// the root inspects globally — find escrows by relationship:
await u.inspect.governedBy(addr);              // escrows this address governs now
await u.inspect.byCoinType(coinType);          // escrows priced in this coin
```

`escrow.inspect.history()` walks the escrow's own transactions (`affectedObject`) —
O(its lifecycle), not O(package history). The curve reconstructions
(`priceTimeline`/`creditHistory`/`tenancies`) replay that log into the curves the
chain computed, drift-zero. Needs a `graphql` endpoint.

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
inbox.react.watch(m => credit(m.amount));                   // income lands → react
u.react.watchMany(ids, e => dashboard(e));                  // many escrows, one firehose
```

|        | continuous (callback) | one-shot (promise) |
|--------|---|---|
| **state** | `escrow.react.watch(cb)` / `cap.react.watch(cb)` | `escrow.react.waitFor(pred)` / `cap.react.waitFor(pred)` |
| **events** | `escrow.react.on(kind, cb)` / `onEvents`, `inbox.react.watch(cb)` | `escrow.react.next(kind)` / `nextEvent` |

`waitFor` resolves to the **handle** (so you can act: `const e = await
escrow.react.waitFor(…); await e.write.applyPendingTransitionStates().send()`), and
its predicate is **async over the handle** — read whatever you need to decide.

Filter not just by event *type* but by a **field value** — `where` is a predicate on
the decoded event (`escrow.react.onEvents(act, { kinds: ['HandoverCompleted'], where:
e => e.data.departing_usufructuary_address === target })`). gRPC can't filter a
payload server-side, but we decode every event anyway, so `where` is free.

## inspect and react are the same events

`escrow.inspect.history()` and `escrow.react.on(...)` decode the **same typed
events** — one paginated over GraphQL (pull), one streamed over the gRPC firehose
(push). Inspect reads the log; react subscribes to it. One event model, two
deliveries.

```
nav     → a related handle  · the object graph        · escrow.nav.activeCap() · cap.nav.escrow() · u.nav.escrow(id)
read    → state, now        · Reader (drift-zero)     · escrow.read.* · cap.read.state() · inbox.read.balance()
inspect → events, pull      · Source.query/events     · escrow.inspect.history · gov.inspect.escrows · u.inspect.governedBy
react   → events, push      · Source.subscribe (gRPC) · escrow.react.watch/on · cap.react.watch · inbox.react.watch
write   → a transaction     · Action.toPtb            · rent · borrow · updateMarket · collect · transfer · integrate
```

Identity + five verbs, on the object you hold (and on `u`, the protocol whole), over a
core that cannot drift. Same shape at every scale — that's the whole API.
