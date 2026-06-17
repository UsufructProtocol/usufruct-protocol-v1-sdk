# Read · Write · Inspect · React — the shape of the SDK

> The whole SDK is **four verbs on a handful of objects**, over a **drift-zero
> core**. One way to remember them — what each verb asks of the chain:
>
> - **read** → what *is*
> - **write** → what I *change*
> - **inspect** → what *happened*
> - **react** → what *happens*
>
> The first two are on-chain **state** (read it / change it with a tx); the last
> two are the **event log** (pull what happened / push what happens). Every verb is
> *object-centric* — you ask the object you hold, it answers — and *decode-free*
> (no asset schema). This is the mental model; see
> [the object model](./object-model.md) for *why* possession is the role.

## The four verbs

| Verb | What | Delivery | Primitive |
|---|---|---|---|
| **Read** | the chain *as it is now* | a fetch / `simulateTransaction` | `Source.fetch` + the `Reader` |
| **Write** | make it *different* | a transaction | `Action.toPtb` |
| **Inspect** | what *happened* | pull (GraphQL) | `Source.query` / `events` |
| **React** | what *happens* | push (gRPC firehose) | `Source.subscribe` |

## The objects

Authority is **possession** of a bearer object, so every verb lives on the object
whose data or right it concerns. Five capability objects:

- **`Escrow`** — the shared market (the hub; everything is keyed to it).
- **`UsufructCap`** — the right of use (the renter's seat).
- **`GovernanceCap`** — governance over a *portfolio* of escrows.
- **`EarningsInbox`** — the governor's income mailbox.
- **`ProtocolFeeInbox`** — the deployer's fee pool (same shape as `EarningsInbox`).

## The grid — four verbs on every object

This is the vision: pick the object you hold, then read / write / inspect / react
*on it*. You never reach back to a factory for an object's own verbs (`u` only
**resolves** the first handle — `u.escrow(id)`, `u.usufructCap(id)`, `u.integrate()`).

| | **read** | **write** | **inspect** (pull) | **react** (push) |
|---|---|---|---|---|
| **Escrow** | `status`, `market()`, `floorPrice`, `cycle()`, `tenureSettlement()`… | `rent()`, `applyPendingTransitionStates()` | `history()`, `usufructCaps()` | `watch()`/`waitFor()`, `on()`/`next()` |
| **UsufructCap** | `state()`, `isActive/isPending/isStale()` | `borrow()`, `burn()`, `updateRefundAddress()`, `transfer()` | `history()` | `watch()`, `waitFor()` |
| **GovernanceCap** | `governs(escrow)` | `updateMarket()`, `retire()`, `claim()`, `extend…()`, `renounce()`, `transfer()`, `integrateIntoPortfolio()` | `escrows()` (its portfolio) | `watch()` (portfolio) |
| **EarningsInbox** / **ProtocolFeeInbox** | `balance()` | `collect()`, `transfer()` | `escrowsPushingMessages()` | `watch()` (new income) |

Two notes on the shape:
- The **escrow is the eager entry handle** — `u.escrow(id)` does the one fetch, so
  its reads are sync getters (a coherent photo at `t`). Every other handle is a
  lightweight **reference** built with no IO, so its reads are on demand
  (`await cap.state()`, `await inbox.balance()`). Both are "ask the object."
- **Possession is a boolean axis**, not a gate on the handles: from an escrow,
  `activeCap` / `governanceCap` / `earningsInbox` / `feeInbox` are *always* present
  to read; `canBorrow` / `canGovern` / `holdsEarnings` say whether a **write** on
  them will succeed.

---

## Read — the chain as it is now

```ts
const escrow = await u.escrow(id);   // state @ t + "what can I do here?", one fetch
escrow.status;          // 'idle' | 'descent' | 'occupied' | 'demand' | 'retired'
escrow.floorPrice;      // a Price, rendered in the escrow's own coin
await escrow.market();  // the full policy (rest price, tenure, handover, curves…)

await escrow.activeCap?.state();   // the current seat — ask the cap about itself
await escrow.reader.accruedCreditMist(now);  // escape hatch: any of the ~80 kernel views
```

**Drift-zero:** every read is the deployed bytecode's own answer
(`simulateTransaction` over the on-chain views), so the SDK can't drift from the
contract. The handle just renders it (`Mist→Price`, `Ms→Date`). For off-chain
re-derivation (simulation, what-if), reach for `@usufruct-protocol/sim` — the
opt-in mirror, golden-tested against this core.

## Write — make it different

```ts
await escrow.rent({ tenures: 1 }).send();                  // pay the floor; `pay` to overpay → stake
await usufructCap.borrow((asset, tx) => { /* your PTB; return is appended */ }).send();
await governanceCap.updateMarket(escrow, { restPrice: escrow.coin(0.02) }).send();
await earningsInbox.collect().send();                      // 90% governor cut, partitioned by coin
await governanceCap.transfer(treasury).send();             // move the object → move the role
```

Each write lives on the object that authorizes it. `transfer` is first-class on
every bearer — moving the object moves the role.

Every write is a **`Plan`**: `.send()` builds, signs, and decodes in one call,
while `.build(tx, sender)` lets you drive the transaction yourself (compose many
writes, mix raw commands, sign with a wallet/Ledger/sponsor). Nothing touches the
chain until `.send()` — reads read, writes wait. See
[write paths](./write-paths.md) for `send` vs `build` and when to use each.

`borrow` is the write that hands you the asset mid-PTB to compose with — variadic
(`cap.borrow(a, b, c)` composes recipes in order), and a `Plan` like the rest. See
[borrow — composing code around the rented asset](./borrow-composition.md).

## Inspect — what happened (pull)

Every object answers two questions: *which escrows relate to me* (discovery) and
*what happened* (history). Same typed event log, decode-free, over GraphQL.

```ts
await governanceCap.escrows();             // discovery: this cap's portfolio
await earningsInbox.escrowsPushingMessages();  // who pays into this inbox
const tx = await escrow.history();         // the escrow's whole lifecycle, time-ordered
const mine = await usufructCap.history();  // just the events that mention this cap
```

`escrow.history()` walks the escrow's own transactions (`affectedObject`) — O(its
lifecycle), not O(package history).

## React — what happens (push)

Don't poll — subscribe over the gRPC checkpoint firehose. React to a **state**
arriving or a **typed event** with its data, continuously or one-shot:

```ts
const stop = escrow.watch(e => render(e));          // state: each change → fresh snapshot
escrow.on('BidPlaced', ev => counterBid(ev.data));  // events: typed, by kind
await escrow.waitFor(e => e.isChallenged);          // one-shot state
await escrow.next('BidPlaced', { timeoutMs: 120_000 });  // one-shot event

usufructCap.watch(seat => render(seat));            // the renter watches THEIR seat
earningsInbox.watch(m => credit(m.amount));         // income lands → react
```

|        | continuous (callback) | one-shot (promise) |
|--------|---|---|
| **state** | `escrow.watch(cb)` / `usufructCap.watch(cb)` | `escrow.waitFor(pred)` / `usufructCap.waitFor(pred)` |
| **events** | `escrow.on(kind, cb)` / `onEvents`, `inbox.watch(cb)` | `escrow.next(kind)` / `nextEvent` |

Filter not just by event *type* but by a **field value** — `where` is a predicate
on the decoded event (`escrow.onEvents(act, { kinds: ['HandoverCompleted'], where:
e => e.data.departing_usufructuary_address === target })`). gRPC can't filter a
payload server-side, but we decode every event anyway, so `where` is free.

## Inspect and react are the same events

`escrow.history()` and `escrow.on(...)` decode the **same typed events** — one
paginated over GraphQL (pull), one streamed over the gRPC firehose (push). Inspect
reads the log; react subscribes to it. One event model, two deliveries.

```
read    → state, now      · Reader (drift-zero)     · escrow.* / cap.state() / inbox.balance()
write   → a transaction   · Action.toPtb            · rent / borrow / updateMarket / collect / transfer
inspect → events, pull    · Source.query/events     · escrow.history / cap.history / governanceCap.escrows
react   → events, push    · Source.subscribe (gRPC) · escrow.watch/on · cap.watch · inbox.watch
```

Four verbs, on the object you hold, over a core that cannot drift. That's the whole
SDK.
