# SDK Architecture

The `@usufruct-protocol/sdk` is built from four primitives. Every capability
the SDK exposes is a composition of these four — none is implemented as
additional core code. This document explains what each primitive is, how they
relate, and what composability emerges from combining them.

---

## Drift-zero core, opt-in mirror

The SDK is split along a single seam: **the core cannot drift; the mirror can.**

- **`@usufruct-protocol/sdk` (core) is drift-zero by construction.** It only
  ever (a) decodes BCS, (b) does IO through `Source`, (c) reads *effective*
  values through the on-chain `Reader` (which evaluates the deployed Move views
  via `simulateTransaction` — so every read is the bytecode's own answer), and
  (d) builds PTBs through an action's `toPtb`. The core never re-derives the
  contract's math in TypeScript. Its only failure surface is the BCS decode,
  guarded by the re-serialize invariant (`serialize(parse(bytes))`, SPEC §10).
  The high-level Layer 2 API (`usufruct()`, `Market`, `escrow.*`) lives here and
  reads everything through the `Reader`, so it inherits drift-zero unchanged.

- **`@usufruct-protocol/sim` (the mirror) is the opt-in tier that *re-derives*
  the protocol off-chain** — `Action.step`, the pure compute `View<T>`
  functions, the fixed-point curve math, and `MemorySource`/`memoryInbox`. This
  is what enables forward simulation across time, what-if analysis, and the
  fully-offline testbed — things the on-chain `Reader` *cannot* do because the
  mutating Move entries read the real `&Clock` (0x6), not a caller-supplied
  time. The mirror takes drift risk and is therefore golden-tested against the
  Reader, its oracle (SPEC §8); the dependency is one-way (`sim → sdk`).

**Why this is possible at all.** A drift-zero core is not a free choice — it is
a property the *protocol* earned. `usufruct` exposes its **entire runtime** as
~124 pure, total, `&Clock`-free view functions (every time-dependent view takes
`now_ms: u64`; SPEC §2.1). That exhaustive read surface is what lets the core
answer *every* effective value on-chain, at any time `t`, with drift zero. A
protocol whose state hides behind dynamic fields, oracles, or cross-object reads
**could not** offer a drift-zero core: its client would have to re-derive read
logic locally, making the mirror the default and drift unavoidable. The split
documented here is downstream of that single enabling fact.

Why purist (the core reads *everything* effective through the Reader, never
locally) rather than reading "simple" fields off a fetched `EscrowState`: the
protocol's transitions are **lazy**, so a stored field and its effective value
at time `t` diverge (an expired tenancy is still stored `Occupied`). Computing
the effective value is exactly the mirror. `Reader.snapshot({ t })` batches the
whole view table into a few `simulateTransaction` calls, so reading everything
on-chain stays cheap — without the stale-state footgun.

The four primitives below describe the **mirror kernel** (`EscrowState` is the
shared decode target; `View`/`Action.step` and `MemorySource` are the mirror).
The core is `EscrowState` + `Source` + the `Reader` + `Action.toPtb`.

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

An `Action` carries two interpretations of the same semantic operation, split
across the two packages:

- **`toPtb`** — the on-chain interpretation (in the **core**). Appends the
  corresponding Move call to a `Transaction`. Used for live execution. In the
  core an action is *only* its `toPtb` (the `PtbAction` type); this is what
  keeps the core drift-free.
- **`step`** — the off-chain pure interpretation (in the **`sim`** mirror).
  Given current state and time, re-derives the next state and result. Used by
  the simulator, testbed, and calendar. The mirror composes a full
  `Origin/Transition/Terminal` action by pairing a `step` with the core's
  `toPtb` builder — one `toPtb` implementation, never duplicated.

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

| Implementation       | Transport       | Best for                                    | Package |
| -------------------- | --------------- | ------------------------------------------- | ------- |
| `ChainSource(client)`| gRPC / JSON-RPC | Object fetches, event streaming             | core    |
| `IndexerSource(url)` | GraphQL         | Filtered queries, cursor-paginated history  | core    |
| `MemorySource()`     | In-memory store | Off-chain testbed; updated by `Action.step` | `sim`   |

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

None of the following are implemented as bespoke code — each falls out of
composition. They split by package along the drift-zero seam: the **reactive
UI**, **settler bot**, and **asset-agnostic marketplace** compose only
`Source` + `Reader` + `toPtb`, so they live in the drift-zero **core**. The
**simulator / time-travel**, **off-chain testbed**, and **calendar / agenda**
fold `Action.step` forward across time and so belong to the **`sim`** mirror —
the one thing the on-chain `Reader` cannot do (its mutating entries read the
real `&Clock`, not an arbitrary future `t`). The examples below use the mirror
factory (`sim.actions.*`) where `step` appears:

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
