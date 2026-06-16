# Read · Write · Inspect · React — the shape of the high-level SDK

> Four verbs cover the whole surface. You **read** the chain, **write** to it,
> **inspect** what it did, and **react** to what it does. Every one is
> object-centric (you ask the object, it answers) and decode-free (no asset
> schema). This is the mental model — start here, then see
> [the object model](./object-model.md) for *why* it's object-centric.

| Verb | What | Delivery | Door |
|---|---|---|---|
| **Read** | the chain *as it is now* | a fetch | `u.escrow(id)` → handle + `escrow.reader` |
| **Write** | make it *different* | a transaction | the capability methods — `rent`, `borrow`, `updateMarket`, `collect`, `transfer` |
| **Inspect** | what *happened* | pull (GraphQL) | discovery (`escrowsGovernedBy`…) + `escrow.history()` |
| **React** | what *happens* | push (gRPC) | `escrow.watch` / `waitFor` + `escrow.on` / `onEvents` |

---

## Read — the chain as it is now

One fetch resolves the state snapshot *and* the signer's role here, so the getters
are synchronous. For live, drift-free values, drop to `escrow.reader` (the ~80
kernel views).

```ts
const escrow = await u.escrow(id);   // state @ t + "what can I do here?", one fetch
escrow.status;          // 'idle' | 'descent' | 'occupied' | 'demand' | 'retired'
escrow.floorPrice;      // a Price, rendered in the escrow's own coin
escrow.coin;            // the payment coin tag (decimals/symbol from chain)
escrow.canGovern;       // do I hold this escrow's GovernanceCap? (possession = role)
escrow.usufructCap;     // the active cap handle, if I hold it (else null)

await escrow.reader.accruedCreditMist(now);   // live, exact, any of the ~80 views
```

The handle is a **coherent photograph** (every field at the same `t`); the reader
is a **live probe**. Render from the handle; observe a write's effect through the
reader. ([Reads: handle-snapshot vs reader-live](./object-model.md).)

## Write — make it different

Each write lives on the **object that authorizes it** — authority is possession,
nothing is hidden. The only decision `rent` asks is the amount (floor, or overpay).

```ts
await escrow.rent({ tenures: 1 });                  // pay the floor; `pay` to overpay → stake
await usufructCap.borrow((asset, tx) => { /* your PTB; return is appended */ });
await governanceCap.updateMarket(escrow, { restPrice: escrow.coin(0.02) });
await earningsInbox.collect();                      // 90% governor cut, partitioned by coin
await governanceCap.transfer(treasury);             // move the object → move the role
```

`integrate` mints three independent bearer objects and hands them back; from there
they diverge. Moving any of them moves the role.
([transfer is first-class](./object-model.md).)

## Inspect — what happened (pull)

Two questions: *which escrows relate to an object* (discovery), and *what happened
to one escrow* (history). Both read the event log, decode-free, paginated over
GraphQL.

```ts
// discovery — each object answers for its relationships
await u.escrowsGovernedBy(me);            // escrows whose GovernanceCap I hold (possession)
await governanceCap.escrows();            // what THIS cap governs (its portfolio)
await earningsInbox.escrowsPushingMessages();  // escrows paying into THIS inbox
await u.escrowsByCoinType(USDC.type);     // escrows priced in USDC
await escrow.usufructCaps();              // every cap this escrow ever minted

// history — one escrow's whole lifecycle, typed and time-ordered
const events = await escrow.history();    // [{ kind:'RentStarted', at, by, data }, …]
//   integrated → policy → rented → bid → displaced → settled → retired
```

## React — what happens (push)

Don't poll — subscribe. Two flavors, both server-push over the gRPC checkpoint
firehose: react to a **state** arriving, or to a **typed event** with its data.

```ts
// continuous (callback) — fires on every change / matching event
const stop = escrow.watch(e => render(e));          // each on-chain change → fresh snapshot
escrow.on('BidPlaced', ev => counterBid(ev.data.pending_bid_amount));

// one-shot (promise) — resolves once, auto-unsubscribed
await escrow.waitFor(e => e.isChallenged);          // the next state that matches
const bid = await escrow.next('BidPlaced', { timeoutMs: 120_000 });  // the next typed event
```

Each kind of subscription comes in two shapes, and they line up:

|        | continuous (callback) | one-shot (promise) |
|--------|---|---|
| **state** | `escrow.watch(cb)` | `escrow.waitFor(pred)` |
| **events** | `escrow.on(kind, cb)` / `onEvents` | `escrow.next(kind)` / `nextEvent` |

(`next` is `waitFor` for events — no more wiring a Promise around `on`.)

The state watch is decode-free (the firehose signals only `object_id`+`version`;
we re-resolve the decode-free handle). The event watch decodes each event with the
same registry History uses. Push is the SDK default — a `SuiGrpcClient` is stood up
for you; it degrades to polling only if you pass a non-gRPC client *and* no network.

## Inspect and react are the same events

`escrow.history()` and `escrow.on(...)` decode the **same typed events** — one
paginated over GraphQL, one streamed over the gRPC firehose. **Inspect** reads the
log; **React** subscribes to it. That symmetry is the point: inspect what the chain
did and react to what it does with one event model.

```
read    → state, now            (u.escrow, escrow.reader)
write   → a transaction         (rent, borrow, updateMarket, collect, transfer)
inspect → events, pull          (escrowsGovernedBy…, escrow.history)
react   → events, push          (escrow.watch/waitFor, escrow.on/onEvents)
```

Read the chain, write to it, inspect what it did, react to what it does — all keyed
on the objects, the object answering for itself.
