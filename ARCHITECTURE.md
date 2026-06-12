# SDK Architecture

The `@usufruct-protocol/sdk` is built from four primitives. Every capability
the SDK exposes is a composition of these four — none is implemented as
additional core code. This document explains what each primitive is, how they
relate, and what composability emerges from combining them.

---

## The four primitives

```
┌─────────────────────────────────────────────────────────────────┐
│                          SOURCE  (IO)                           │
│                                                                 │
│   ChainSource(gRPC)      IndexerSource(GraphQL)   MemorySource  │
│        │                        │                      │        │
│        └────────────────────────┴──────────────────────┘        │
│                                 │                               │
│              fetch / subscribe / query                          │
└─────────────────────────────────┬───────────────────────────────┘
                                  │ Promise<EscrowState>
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                       ESCROW STATE  (data)                      │
│                                                                 │
│         EscrowState<Asset, CoinType>                            │
│         BCS-decoded · immutable · no network reference          │
└────────────────────┬──────────────────────┬─────────────────────┘
                     │                      │
          (state, t) │                      │ (state, t)
                     ▼                      ▼
┌────────────────────────┐    ┌─────────────────────────────────┐
│      VIEW  (read)      │    │        ACTION  (write)          │
│                        │    │                                 │
│  (state, t: Ms) => T   │    │  step:  (state, t) => state'   │
│                        │    │  toPtb: (tx) => PTB call        │
│  · pure                │    │                                 │
│  · deterministic       │    │  Origin     → creates state     │
│  · free function       │    │  Transition → mutates state     │
│                        │    │  Terminal   → consumes state    │
│  isIdle(state, t)      │    │                                 │
│  currentPrice(s, t)    │    │  Rent(payment).step(s, t)      │
│  tenureExpiry(s, t)    │    │  Rent(payment).toPtb(tx)       │
└────────────────────────┘    └──────────────┬──────────────────┘
                                             │
                              step  ──► EscrowState  (loop)
                              toPtb ──► Transaction  (chain)
```

---

### `EscrowState<A, C>` — data

The BCS-decoded snapshot of an `Escrow<Asset, CoinType>` shared object. It is
plain data: immutable, serializable, carrying no reference to a network client,
clock, or event stream.

`EscrowState` is the SDK's single representation of "what the chain currently
knows about this escrow". Every View and Action consumes it; every Source
produces it.

---

### `View<T>` — read

```ts
type View<T> = (state: EscrowState, t: Ms) => T
```

A free function. One `View` per public view in `usufruct/sources/escrow.move`.
Given the same `(state, t)`, it always returns the same `T` — no network, no
randomness, no side effects.

Time is always an explicit parameter. There is no ambient `now()`. This is what
makes Views usable in simulators, calendars, and off-chain testbeds without any
special setup.

---

### `Action<R>` — write

An `Action` is a **value** that carries two interpretations of the same
semantic operation:

- **`step`** — the off-chain pure interpretation. Given current state and time,
  returns the next state and result. Used by the simulator, testbed, and
  calendar.
- **`toPtb`** — the on-chain interpretation. Appends the corresponding Move
  call to a `Transaction`. Used for live execution.

Actions are classified by their lifecycle role:

| Variant    | Effect                        | Example                   |
| ---------- | ----------------------------- | ------------------------- |
| Origin     | Creates an `EscrowState`      | `integrate`               |
| Transition | Mutates an `EscrowState`      | `rent`, `borrow`, `retire`|
| Terminal   | Consumes an `EscrowState`     | `claimAsset`              |

The TypeScript type system enforces these roles. A Terminal action returns no
successor state — the compiler rejects any attempt to chain another action
after it.

---

### `Source` — IO

```ts
interface Source {
  fetch:     (id: Id<Escrow>) => Promise<EscrowState>
  subscribe: (id: Id<Escrow>) => Observable<EscrowState>
  query:     (predicate: Predicate) => AsyncIterable<EscrowState>
}
```

The **only point of impurity** in the SDK. All network IO is mediated through
`Source` implementations. The rest of the SDK does not know which `Source` it
has been given.

Three implementations ship with the core:

| Implementation       | Transport       | Best for                                    |
| -------------------- | --------------- | ------------------------------------------- |
| `ChainSource(client)`| gRPC / JSON-RPC | Object fetches, event streaming             |
| `IndexerSource(url)` | GraphQL         | Filtered queries, cursor-paginated history  |
| `MemorySource()`     | In-memory store | Off-chain testbed; updated by `Action.step` |

---

## How composability emerges

The four primitives are **closed under composition**:

- `pure data × pure data` = pure data (records of records)
- `View ∘ View` = another View (pure functions compose)
- `Action.step ∘ Action.step` = a composed state machine
- `Source` is the only IO and lives _above_ the composition layer — it never
  pollutes downstream

Because the layer is closed, every capability the SDK offers emerges for free
from combining what already exists — no new core code required.

### Data flow

```
Source.fetch(id)
  → EscrowState
      → View(state, t)              // read anything, pure
      → Action.step(state, t)       // predict next state, pure
          → state'
              → View(state', t)     // read predicted state
              → Action.step(state', t) → state'' // chain transitions
      → Action.toPtb(tx)            // execute on-chain
          → chain confirms
              → Source.fetch(id)    // loop: new ground truth
```

### Emergent capabilities

None of the following are implemented as core code. Each falls out of composing
the four primitives:

**Simulator / time-travel**
```ts
// Fetch state once, then fold actions forward in time — no network needed.
const state1 = await source.fetch(escrowId)
const state2 = Rent(payment).step(state1, t).state
const state3 = ApplyPendingTransitions.step(state2, t + oneDay).state
const price   = currentPrice(state3, t + oneDay)
```

**Reactive UI**
```ts
// Subscribe once. Between emissions, Views over the last known state are exact.
source.subscribe(escrowId).subscribe(state => {
  render(isIdle(state, now()), currentPrice(state, now()))
})
```

**Settler bot**
```ts
// No scheduler needed — the View tells you when to fire.
const due = nextPendingAt(state, t)
if (due <= now()) {
  const tx = new Transaction()
  ApplyPendingTransitions.toPtb(tx)
  await client.signAndExecuteTransaction(tx)
}
```

**Off-chain testbed**
```ts
// Swap Source for MemorySource. Every View and Action runs identically.
const source = new MemorySource()
await source.seed(escrowId, initialState)
// ...run the full protocol flow without touching the network
```

**Asset-agnostic marketplace**
```ts
// query() returns any escrow that matches — the SDK is generic over A and C.
for await (const state of source.query(byOwner(address))) {
  listings.push(toListing(state, now()))
}
```

**Calendar / agenda**
```ts
// Fold nextPendingAt recursively to build a full schedule.
function buildSchedule(state: EscrowState, horizon: Ms): Transition[] {
  const due = nextPendingAt(state, now())
  if (!due || due > horizon) return []
  const next = ApplyPendingTransitions.step(state, due).state
  return [{ at: due, state }].concat(buildSchedule(next, horizon))
}
```

---

## Why no fifth primitive

The closure property is what permits emergence. Adding a primitive would either
duplicate an existing composition (`Schedule` = `View` + `Action`) or bake a
prediction about future use cases into the kernel.

Every accommodation beyond the four primitives lives in **convenience layers**
— downstream packages that compose the core without contaminating it. The
kernel stays at the lowest non-trivial level of abstraction; the ceiling stays
open.

---

## Further reading

- `SPEC.md` — normative design specification; governs all implementation decisions
- `CLAUDE.md` — development rules and testnet context
- Protocol source: https://github.com/UsufructProtocol/usufruct-protocol-v1
