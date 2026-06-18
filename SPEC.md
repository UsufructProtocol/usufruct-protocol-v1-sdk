# Functional SDK — Specification

**Status:** Design reference. Authoritative for implementation decisions.
**Scope:** TypeScript SDK for the `usufruct` Move package.
**Branch:** `functional-sdk-design`.

---

## §1 — Purpose

This document specifies the architecture and design principles of the TypeScript
SDK for `usufruct`. It is the reference consulted before adding code: any
proposed module, type, or function must either fit one of the primitives defined
here, or it must justify amending this document.

The SDK is not yet implemented. This spec governs how implementation proceeds.

---

## §2 — Background

The `usufruct` Move package has reached structural stability. The public surface
is consolidated in `usufruct/sources/escrow.move` (entries + views grouped by
banner). All view functions are pure projections; the runtime layer is lazy and
permissionless; the read path has no oracle, no dynamic-field traversal, no
cross-object composition.

These are unusual properties for a Sui protocol. They enable a class of SDK
ergonomics that most on-chain protocols cannot offer, because their on-chain
data shape forbids those ergonomics. Protocols that store state in dynamic
fields or slice-trees cannot reconstruct derived state client-side and must
route every read through `simulateTransaction`. Protocols that store
bounded-cardinality state in dynamic fields can walk it client-side but must
reimplement fixed-point math in TypeScript to avoid `devInspect` round-trips —
at the cost of drift risk whenever the on-chain math changes.

`usufruct` avoids both failure modes: a single shared object per
escrow, no dynamic fields, no oracle, no cross-object reads. This is what
permits the design specified below.

### §2.1 — Two tiers

This protocol exposes 120+ public **view functions**, all pure projections,
source-verified on-chain. Crucially, the view block of `escrow.move` takes
**zero `&Clock`**: every time-dependent view takes `now_ms: u64` as an
explicit argument. That single fact decides the SDK's shape.

The SDK is therefore two tiers, in priority order:

1. **The thin wrapper (default).** A read is a call to the protocol's own
   view, evaluated by the deployed bytecode via `simulateTransaction`, with
   the BCS return decoded. Drift is **zero by construction** — the answer is
   the contract's answer. Because the views are `&Clock`-free, this tier also
   does *time-travel reads* (evaluate any view at any `now_ms` the caller
   supplies); it forgoes only evaluation over *hypothetical state* that does
   not yet exist on chain. This is the surface for scripting, dashboards, and
   any one-shot read. It is mostly the codegen substrate (§4.5) plus a
   `simulateTransaction` runner.

2. **The functional core (opt-in).** A TypeScript mirror of the protocol's
   state and transitions — `EscrowState` / `View` / `Action.step` (§4) —
   enabling computation the wrapper cannot: folding actions over hypothetical
   futures (simulator, "what-if"), running the whole protocol off-chain
   (testbed via `MemorySource`), or building an agenda without N round-trips.
   This tier re-derives the protocol's logic and therefore *takes* drift
   risk; the on-chain views (tier 1) are the golden oracle it is tested
   against (§8). A mirror without golden coverage is not shipped — the
   consumer falls back to the wrapper.

The two tiers map onto the drift-zero package split (§4): **tier 1 is the core**
(`@usufruct-protocol/sdk` — `Source` for IO, the `Reader` over the codegen
substrate, and `Action.toPtb`), and **tier 2 is the mirror** (`@usufruct-protocol/
sim` — `EscrowState` + `decodeEscrowState`, `View`, `Action.step`). Tier 1 needs
no decoded model: it is generated calls + IO + on-chain views. The error most
SDKs make — re-implementing the contract's read logic in the client, then
drifting from it — is avoided by making tier 1 the default and confining tier 2's
re-derivation to the cases that genuinely need off-chain computation.

---

## §3 — Core design principle

> **State is data, not object. Action is value, not method. Time is parameter,
> not context.**

These clauses govern the **functional core (tier 2, §2.1)** — the opt-in
mirror. They do *not* describe the default read path: a default read is a
call to the on-chain view (tier 1), whose answer needs no local state and no
mirror. The principles below constrain how the mirror is built *when* a
consumer opts into local computation.

Each clause is a normative constraint:

- **State is data, not object.** The SDK's representation of an `Escrow` is a
  plain BCS-decoded value. It carries no reference to a network client, no
  clock, no event subscription. Methods on state are forbidden.
- **Action is value, not method.** Every semantic operation of the protocol
  (`rent`, `borrow`, `claim`, `apply_pending_transition_states`, …) is a
  first-class value with two interpretations defined in §4.3. It is not a
  method on state.
- **Time is parameter, not context.** Any computation that depends on time
  takes `t: Ms` as an explicit argument. The Move equivalent `&Clock` is
  unwrapped at the call site. There is no ambient `now()`.

If any proposed code violates these, the proposal is rejected, not the spec.

---

## §4 — The four primitives

The SDK is built from exactly four primitives, sitting on a codegen substrate
(§4.5). Every capability listed in §6 is a composition of these primitives;
none is implemented as additional core code.

> **Drift-zero split (where each primitive lives).** The default read is the
> on-chain view (§6.1), so the **core** (`@usufruct-protocol/sdk`) never decodes
> an escrow. The core holds **`Source`** (yielding a raw `EscrowSnapshot`),
> **`Action.toPtb`**, and the **`Reader`** (§6.1). The *decoded* model and its
> re-derivations are the **mirror** (`@usufruct-protocol/sim`): **`EscrowState`**
> + `decodeEscrowState`, **`View`**, and **`Action.step`**. The dependency arrow
> is sim → sdk. The four concepts below are unchanged; they are split by where
> drift can occur. (See §12 decision log.)

### §4.1 — `EscrowState<A, C>` (data) — *mirror*

The BCS-decoded snapshot of an `Escrow<Asset, CoinType>` shared object,
including its full `AssetContext` subtree. **Lives in the mirror**
(`@usufruct-protocol/sim`): a `Source` yields the raw `EscrowSnapshot` (ids +
type tag + BCS bytes), and `decodeEscrowState(snapshot, assetSchema)` produces
an `EscrowState`. The core never names it — it reads via the `Reader` (§6.1).

Properties:

- Immutable (TypeScript `readonly` at the type level).
- Serializable (it is itself the result of BCS decoding).
- Contains no reference to an RPC client, clock, or event stream.
- Parameterized over `A` (asset BCS schema) and `C` (coin type marker).

`EscrowState` is the data shape the mirror's views and `step`s consume — the
mirror's representation of "what the chain currently knows about this escrow".

### §4.2 — `View<T>` (read) — *mirror*

```
View<T> = (state: EscrowState, t: Ms) => T
```

Free function. One `View` per public view function in `usufruct/sources/escrow.move`.
Lives in the mirror (`@usufruct-protocol/sim`); the core's default read is the
on-chain view via the `Reader` (§6.1), not a `View` over a decoded `EscrowState`.

Properties:

- Pure: same `(state, t)` always yields the same `T`.
- Deterministic: no randomness, no network.
- Free function: never a method on `EscrowState`. Stored as a value, passed as
  an argument, composed with `pipe`/`map`/`scan`.

Views correspond term-to-term with Move's `proj_*` projections and the public
view functions in `escrow.move`. The §7 correspondence table specifies the
mapping.

### §4.3 — `Action<R>` (write)

The most distinctive primitive. An `Action` is a **value** carrying two
interpretations of a single semantic operation — **split across the drift-zero
seam**:

- `toPtb` — on-chain interpretation. Append the corresponding Move call to a
  `Transaction`. Used by live execution. **Core** (`@usufruct-protocol/sdk`): the
  core action surface is `PtbAction` = `{ toPtb }`, nothing else.
- `step` — off-chain pure interpretation `(state, t) => next`. Used by simulator,
  testbed, calendar. **Mirror** (`@usufruct-protocol/sim`): pairs a `step` with
  the core's `toPtb` into the lifecycle types (`Origin`/`Transition`/`Terminal`
  Action, generic over the state aggregate `S` — `EscrowState` for escrows,
  `MessageGroups` for inboxes). Confining the core to `toPtb` is what makes it
  impossible to drift.

Every public mutating function of `usufruct` is classified by its lifecycle
role, which determines its `Action` variant:

```
interface OriginAction<R, P> {        // creates an EscrowState
  step:  (t: Ms) => { state: EscrowState; result: R };
  toPtb: (tx: Transaction, args: P) => R_ptb;
}
interface TransitionAction<R, P> {    // mutates an EscrowState
  step:  (state: EscrowState, t: Ms) => { state: EscrowState; result: R };
  toPtb: (tx: Transaction, args: P) => R_ptb;
}
interface TerminalAction<R, P> {      // consumes an EscrowState
  step:  (state: EscrowState, t: Ms) => { result: R };
  toPtb: (tx: Transaction, args: P) => R_ptb;
}
```

`step` is unconditionally deterministic in `(state, t)` — the protocol has no
stochastic policy, so there is no `Rng` parameter (§8).

The variants are generic over the **state aggregate** they govern, with
`EscrowState` as the default (amended 2026-06-12): every escrow action uses
the default; inbox actions (`collectMessages`) are `TransitionAction`s over
`MessageGroups`, the decoded inbox contents. This is genericity, not a new
primitive — the kernel's shape is unchanged.

The variants are not stylistic — they encode lifecycle constraints in the type
system. `claimAsset` returns no successor state; the TypeScript compiler
rejects any attempt to chain another action after it. `integrate` is the only
action whose `step` does not require an existing state.

This is the Free-monad / Command pattern. The same `Rent(payment, cycles)`
value can be executed against an in-memory state for prediction, or composed
into a PTB for actual execution. Both interpretations are required to produce
equivalent observable effects (§8 invariant).

The 11 mutating actions, classified by variant:

| Variant      | Actions                                                                                |
| ------------ | -------------------------------------------------------------------------------------- |
| Origin       | `integrate`                                                                            |
| Transition   | `withdrawEarnings`, `retire`, `extendCommitment`, `updateConfig`, `rent`, `borrowAsset`, `returnAsset`, `burnTenantCap`, `applyPendingTransitionStates` |
| Terminal     | `claimAsset`                                                                           |

`&Clock` and `&mut TxContext` appear in Move signatures but are FFI
artefacts, not semantic inputs. The SDK injects the `0x6` clock singleton
automatically at `toPtb` time; `TxContext` is supplied by the transaction
runtime. Neither appears in any `Action` constructor. (Earlier protocol
versions also threaded `&Random` for stochastic policies; that feature was
removed — the protocol is now fully deterministic, so no `step` consumes
randomness. See §8.)

### §4.4 — `Source` (IO) — *core*

```
interface Source {
  fetch:     (id: Id<Escrow>) => Promise<EscrowSnapshot>;
  subscribe: (id: Id<Escrow>, opts?) => AsyncIterable<EscrowSnapshot>;
  query:     (predicate: Predicate) => AsyncIterable<EscrowSnapshot>;
}
```

The single point of impurity in the SDK. It yields the **raw `EscrowSnapshot`**
(ids + type tag + BCS bytes); turning that into a decoded `EscrowState` is a
mirror step (`decodeEscrowState`, §4.1), so the core's IO boundary does not
depend on the decoded model. All network IO is mediated through `Source`
implementations. `subscribe`/`query` are `AsyncIterable` (not an
Observable) to avoid a reactive-library dependency. `chainSource(client)`
works over any `ClientWithCoreApi` (gRPC or JSON-RPC), constrained by what
that transport-agnostic core API actually offers:

- **`fetch`** — `core.getObject` + BCS decode.
- **`subscribe`** — the core API has **no push stream** (streaming is
  gRPC-only, `SuiGrpcClient.subscriptionService`). So `chainSource.subscribe`
  **polls** `getObject` on an interval and yields only when the object
  *version* changes (the first state immediately); it stops cleanly on an
  `AbortSignal`. Push via gRPC is an opt-in transport layer (`grpcSource`),
  not the kernel.
- **`query`** — escrows are **shared** objects, so they cannot be listed by
  owner. The reachable handle is the caller's *owned* `UsufructCap`, which
  carries its escrow id. `query({ byUsufructuary })` lists those caps
  (`core.listOwnedObjects`, paginated), maps each to its escrow, dedupes, and
  `fetch`es — "the escrows this address rents". A cap outlives its escrow, so
  targets that no longer exist are skipped. Broader discovery (by governor, by
  asset/coin type, history) needs an indexer — see `IndexerSource`, §6.3.
- `grpcSource(grpcClient, { packageId, assetSchema? })` — **gRPC-only**,
  implemented. Same `Source` contract, but `subscribe` is **server push**
  instead of poll. `fetch`/`query` delegate to an internal `chainSource` over
  the same client; only `subscribe` differs. It opens
  `subscriptionService.subscribeCheckpoints` — a *firehose* (no per-object or
  per-event filter; `readMask` rooted at the `Checkpoint` selects only each
  changed object's id + post-tx version), scans every checkpoint's transaction
  effects for the escrow, and on a real version change does one `getObject` +
  decode (effects carry id+version, not contents). Dedupe is by post-tx
  version; a dropped stream re-opens with bounded backoff (resumable without
  gaps — replays are absorbed by the dedupe). Latency ≈ a checkpoint vs a poll
  interval, and zero traffic while the escrow is idle. Proven live on testnet:
  push landed 1.5 s after a mutating tx was sent. Because every stream is the
  *same* firehose, an extra `subscribeMany(ids)` opens it **once** and
  demultiplexes by id — N escrows watched over one subscription, emitting
  `{ escrowId, state }` tagged updates (initial state per id, then per-id
  version-deduped deltas). The set is **live-editable**: `subscribeMany` returns
  a handle (an `AsyncIterable` plus `add`/`remove`/`close`) so a consumer can
  grow or shrink the watched set in flight without reopening the firehose —
  `add(id)` emits the new escrow's initial state and starts watching, `remove(id)`
  stops, `close()` ends. Proven live: opened on one escrow, `add`ed a second in
  flight and received its initial, then routed a mutation to its tag.
- `indexerSource(graphqlClient, { packageId })` — **non-core** (§6.3),
  implemented. `SuiGraphQLClient` (`@mysten/sui/graphql`) is the transport. It
  is `Source`-conformant: `fetch`/`subscribe`/`query({byUsufructuary})`
  delegate to a `chainSource` over the GraphQL client's `.core`; the
  indexer-only predicates use raw GraphQL — `query({byGovernor})` via
  `AssetIntegrated` events filtered by `sender` (= governor), and
  `query({byAssetType})` / `query({all})` via `objects(filter:{type})`,
  paginated and deduped, skipping consumed escrows. `events({type, sender?})`
  yields **typed** events (`TypedEvent { type, module, name, sender, timestamp,
  escrowId, data }`); `escrowTimeline(escrowId)` fans out the ~25 escrow-keyed
  event types (bounded concurrency), filters by `escrow_id` client-side (the
  GraphQL `EventFilter` matches only type/module/sender/checkpoint — *not* a
  payload field — and `MoveEventField` was dropped in `@mysten/sui` v2, so there
  is *no* server-side payload filter at all), and merges into one time-ordered
  history — the star schema's `escrow_id` PK as an API. The payload is
  **BCS-decoded from the node's `contents.bcs`** (the MoveValue's pure struct
  bytes) with the codegen structs — bit-exact, cross-checked live against the
  indexer's `json`. (The node's `eventBcs` is *not* the struct BCS — it is
  wrapped in a type-tag envelope whose first 32 bytes are the package id;
  decoding it mis-reads `escrow_id`. `contents.bcs` is the right field, caught
  live.) The indexer lags the fullnode — reads reflect the index; poll if you
  need read-after-write.
- `memorySource(seed?)` — **implemented**. In-memory `Source` for the testbed:
  a `Map`-backed store of `EscrowState` that `Action.step` advances, no network.
  Same contract — `fetch` reads the store; `subscribe` is event-driven (initial
  state, then on every `set`, deduped by an internal revision, abortable);
  `query` answers what `EscrowState` alone can — `all`, `byAssetType`,
  `byUsufructuary` (via `activeUsufructuaryAddr`) — and throws on `byGovernor`
  (the governor address is not in the escrow; same honest limit as
  `chainSource`). A testbed control surface — `set`/`delete`/`has`/`size` and
  `apply`/`applyOrigin`/`applyTerminal` — feeds a step's successor back in, with
  the clock as an explicit `t: Ms` (§3). Proven live: seeding a chain-fetched
  state and running a view through it gives the same answer as over
  `chainSource` (the §7 substitution property).
- `memoryInbox(seed?)` — **implemented**. The off-chain mirror of the *second*
  aggregate: the inbox, keyed by inbox object id, holding coin-polymorphic
  `MessageGroups`. `post` adds a message, `fetch` partitions by coin type (the
  `discoverInboxMessages` mirror, §5.2), `collect` drains via the canonical
  `collectMessages().step` fold. `postSettlement` bridges escrow → inbox (90% of
  a handover/tenure settlement → earnings, 10% → protocol fee), closing the
  economy in RAM — `memorySource` stays unaware of inboxes. Proven live: seeded
  with the live `discoverInboxMessages` groups, it reproduces the chain's
  partition and per-coin totals exactly (§5.2).

The rest of the SDK does not know which `Source` it has been given. This is
what permits the testbed (§6.5) and live SDK to share **identical** view and
action code.

### §4.5 — Codegen substrate

Under all four primitives sits a generated layer:

- TypeScript types mirroring every `public struct` in `usufruct`.
- BCS schemas for every type, derived from Move ABI.
- Bare PTB call wrappers — one TypeScript function per `public fun`.

This layer is **regenerated** from `usufruct/sources/` on every `sui move build`.
Views (§4.2) and Actions (§4.3) are hand-written *on top of* the generated
layer; they import from it. A change to a Move signature surfaces as a
TypeScript compile error in the hand-written layer, identifying exactly what
needs updating.

The codegen layer is mechanical. The primitives above it carry the semantic
discipline.

---

## §5 — Move ↔ TypeScript correspondence

The SDK transcribes the Move package's functional idioms term-by-term. It does
not impose a new style; it reads the style already present.

| Idiom in `usufruct` (Move)                                    | SDK equivalent (TypeScript)                                      |
| ------------------------------------------------------------- | ---------------------------------------------------------------- |
| `proj_*(&T): DomainType`                                      | `View<T> = (state, t) => T`                                      |
| `execute_*(ctx, args): (ctx', result)`                        | `Action.step(state, t) => { state, result }`                     |
| `take_context` → transform → `put_context`                    | `state2 = action.step(state).state` (immutable update)           |
| `Identity` + `Material` split                                 | branded `Id<T>` + BCS-decoded material                           |
| Hot-potato enum (`PendingTransitionState`, …)                 | discriminated union + branded "consume token" pattern            |
| Domain types (`Stake`, `Price`, `Timestamp`, `Duration`, `Bps`) | branded `bigint` types (zero runtime overhead)                 |
| `Option<T>`                                                   | discriminated union or `T \| null` (chosen per case)             |
| `enum CurveShape { Linear, Smoothstep, ... }`                 | `type CurveShape = { kind: 'linear' } \| { kind: 'smoothstep' } \| ...` |
| Error constants (`E_*`)                                       | `Result<T, ProtocolError>` with codes union                      |
| No mutable shared state                                       | no `class`, no `this`, no field mutation                         |

### §5.1 — The collapse that TypeScript performs

The Move public surface exposes one `proj_*_is_X` predicate plus one
`proj_*_field` accessor per enum-variant payload (e.g. `credit_curve_is_linear`,
`credit_curve_is_logistic`, `credit_curve_power_law_alpha_num`, …). This is an
artefact of the Move/FFI boundary, not of the underlying semantics.

The SDK collapses this into a single BCS decoding plus an exhaustive `switch`:

```ts
const curve = creditCurve(state);
switch (curve.kind) {
  case 'linear':      /* … */ break;
  case 'logistic':    /* curve.k */ break;
  case 'powerLaw':    /* curve.alphaNum, curve.alphaDen */ break;
  case 'exponential': /* curve.alphaAbs, curve.alphaNeg */ break;
}
```

TypeScript's exhaustiveness checking ensures the same total-function discipline
that Move enforces on the producer side. This collapse is normative: the SDK
does not expose the unrolled `_is_X` / `_field` API.

The collapse extends beyond enum payloads to every unrolled FFI family
(adopted 2026-06-12): the `*_kind` string views collapse into the same
discriminated unions, and the per-field cycle-params accessors
(`{active,pending,next}_ensemble_{floor,ceiling,handover,descent}_*`)
collapse into record views (`activeCycleParams`, …). The unrolled on-chain
views remain the parity oracle: the e2e harness reconstructs each union from
them and asserts equality against the collapsed view.

### §5.2 — What Move enforces that TS cannot replicate

- Linearity (no `drop`, no `copy`).
- Resource ABI (no duplication of typed assets).

These guarantees protect the **protocol**, which lives on-chain. The SDK does
not need to defend them; it needs only to not violate them in the PTBs it
submits. The chain rejects violations at execute time, so the defence is
preserved where it belongs.

**The one type the SDK must check at construction time — `Receiving<T>` over a
coin-polymorphic inbox.** The `EarningsInbox` / `ProtocolFeeInbox` are *not*
generic over `CoinType` (`ProtocolFeeInbox { id: UID }`): a single inbox
aggregates `EarningsMessage<C>` / `FeeMessage<C>` for *every* coin a governor
rents in. Collection is `collect_earnings_messages<C>(inbox, tickets:
vector<Receiving<EarningsMessage<C>>>)`, called once per `C`. A `Receiving<T>`
is opaque — `(id, version, digest)` — so Move cannot verify the target object's
coin type until the native `0x2::transfer::receive` runs; a ticket whose target
is `…<SUI>` passed under `C = USDC` therefore aborts deep inside
`0x2::transfer::receive_impl` (code 2), an **opaque framework abort, not a
protocol error** — and Move has no try/catch to re-wrap it. Unlike a normal
object argument (whose type the PTB resolver checks early, yielding a clean
`CommandArgumentError`), this mismatch is only caught at runtime. Therefore the
collect `Action` (§4.3) must **partition the inbox's messages by coin type and
emit one collect PTB per `C`, filtering tickets by the fully-qualified
`EarningsMessage<C>` / `FeeMessage<C>` type** — so a mismatched ticket is never
constructed. This is the single place the type discipline lives in the SDK, not
the chain; observed live during the v1.4.2 adversarial audit (a DUMMY_COIN-typed
collect over an inbox holding `FeeMessage<SUI>` aborted exactly here).

**Ownership asymmetry.** The two inboxes differ in custody: the `EarningsInbox`
is **one per governor** (created at `integrate`, owned by the governor — who
collects their own 90%); the `ProtocolFeeInbox` is **one global object owned by
the protocol deployer** (`init` `public_transfer`s it to the publisher; the
`ProtocolFeeRef` is frozen), accumulating the 10% from *every* escrow of *every*
governor. The collect fn carries no capability — **ownership of the inbox object
is the authority** (passing it `&mut` requires the owner), and the collected
`Coin<C>` goes to `ctx.sender()`. So fee collection must be **owner-signed**.
Verified live (2026-06-14): owner-signed collect of the run's own `FeeMessage`s
(selected by `fee_message_id`) — `collected == posted` per coin (DUMMY_COIN,
SUI). The off-chain mirror of this — many escrows' 90% to per-governor earnings
inboxes, every 10% into one global fee pool — is `memoryInbox` + `postSettlement`.

---

## §6 — Read strategy

> **The default read is the on-chain view. The TypeScript mirror is opt-in.**
> (Inverts the prototype's original default; see §12.)

### §6.1 — The thin wrapper (`read`) — default

A read calls the protocol's own view via `simulateTransaction`
(`checksEnabled: false`) and decodes the BCS return. The answer is produced
by the deployed bytecode, so **drift is zero by construction**. The only
residual failure mode is a *decode* bug in the SDK — caught by the same
golden fixtures (§8.2) — not a logic divergence.

The surface is a bound **`Reader`**:

```
const r = createReader(client, { packageId, escrowId, typeArguments });
await r.isIdle();            // boolean        (on-chain)
await r.handover();          // Handover       (on-chain, collapsed §5.1)
await r.floorPriceMist(t);   // Mist           (time-parameterised)
const snap = await r.snapshot({ t });  // batched: whole table in few sims
```

This covers the **entire** read surface of `escrow.move` (≈124 views) plus
`cap.move` / `fees.move`, not a subset. Two properties of the protocol make
it both correct and complete:

- **`&Clock`-free views (§2.1).** Every time-dependent view takes
  `now_ms: u64`. The wrapper passes the caller's `t` as that argument, so it
  evaluates any view at any time — *time-travel reads with zero drift*. It
  cannot evaluate a view over a state that does not exist on chain; that is
  tier 2's job.
- **Pure, total projections.** No oracle, no dynamic-field walk — one
  `simulateTransaction` returns every view's value; `snapshot` batches the
  whole table into a handful of simulations.

The wrapper carries no domain logic: it is the codegen call wrappers (§4.5)
plus a decode table (`src/read/spec.ts`) plus the `simulateTransaction`
runner. Protocol aborts surface verbatim (e.g. `tenure_settlement` aborts on
a non-rented escrow — the wrapper relays the contract's own abort, not an SDK
error).

### §6.2 — The TypeScript mirror (Pattern B) — opt-in

For computation the wrapper cannot do — folding `Action.step` over
hypothetical futures (simulator, "what-if"), running the protocol entirely
off-chain (testbed via `MemorySource`), or building an agenda over N escrows
without N×views round-trips — the SDK offers the functional core (§4):
`EscrowState` decoded once, then pure `View` / `Action.step` evaluated
locally at any `(state, t)`.

This tier **re-derives** the protocol's logic and therefore takes drift risk.
It is gated by §8.2: a mirror ships only with cross-runtime golden coverage
against the on-chain view (its oracle). Mirrors of curve / settlement math
that have not earned that coverage are *not* shipped — the consumer uses the
wrapper instead. The mirror is opt-in precisely because the default
(`read`) is already correct and complete; the mirror exists to trade a
round-trip for local computation where that trade pays.

### §6.3 — Pattern C (indexer) — non-core

History, aggregations, and discovery queries (e.g. "all escrows owned by
address X", "events on escrow Y over the last N days") use an external indexer.
This is a non-core capability provided by `IndexerSource` and is out of scope
for the SDK kernel.

---

## §7 — Emergent capabilities

The following capabilities are listed as **compositions** of the four
primitives. None is implemented as additional core code; each falls out of
combining what §4 already provides. If a capability listed here required new
core code, the design has failed.

| Capability                          | Composition                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------------------- |
| Simulator / time-travel             | `decodeEscrowState(Source::fetch(id))` → `EscrowState` (mirror); then `View(state, t)` and `Action::step(state, t).state` chain.  |
| Settler bot                         | `View=nextPending` returns `t*`; timer fires `ApplyPendingTransitionStates::toPtb` + execute.     |
| Calendar / temporal index           | Iterate `nextPending` + `step(ApplyPendingTransitionStates)` recursively until horizon.           |
| Reactive single-writer state        | `Source::subscribe(id)` emits new `EscrowState`. Between emissions, `View(state, t)` is correct.  |
| Whole-protocol off-chain testbed    | Substitute `Source = MemorySource()`. Identical `View` and `Action` code; no chain touched.       |
| Asset-agnostic marketplace          | `Source::query(byOwner(addr))` yields `AsyncIterable<EscrowSnapshot>`; `decodeEscrowState` (mirror) gives `EscrowState<A, C>` — the SDK is asset-agnostic. |
| DSL config builder                  | Typed builder produces `IntegrationConfig` value; consumed by `Integrate(asset, cfg)::toPtb`.     |

The reason these emerge: the four primitives are closed under composition.

- Pure data × pure data = pure data (records of records).
- Pure function ∘ pure function = pure function (views chained).
- `Action::step` ∘ `Action::step` = composed state machine.
- `Source` is the only `IO` and lives *above* the composition layer; it does
  not pollute downstream.

This is the property the design exists to preserve.

### §7.1 — Why these primitives, not a higher-level abstraction

The closure-under-composition property is what *permits* emergence. It is also
what *bounds* the choice of primitives: any alternative kernel must preserve
closure, or it surrenders emergence.

A primitive set qualifies as kernel-fit if and only if both criteria hold:

1. **Minimum sufficiency.** Each primitive sits at the lowest non-trivial level
   of abstraction. Lower would not be useful; higher would predict use cases.
2. **Orthogonality.** No primitive is expressible as a composition of the
   others.

The four chosen primitives pass both:

| Primitive     | Minimum sufficient?                                              | Orthogonal?                                                |
| ------------- | ---------------------------------------------------------------- | ---------------------------------------------------------- |
| `EscrowState` | Yes — it is the chain's ground truth.                            | Yes — not derivable from the others.                       |
| `View<T>`     | Yes — it is literally `proj_*` in `escrow.move`.                 | Yes — `Action` does not imply it.                          |
| `Action<R>`   | Yes — it is literally `execute_*` in `asset_context_state.move`. | Yes — `View` does not imply it.                            |
| `Source`      | Yes — it is the only ineluctable `IO`.                           | Yes — the purity of the other three requires it separated. |

The canonical alternative considered and rejected is **Schedule-first**:
promote the protocol's lazy-permissionless-settlement property to a fifth
primitive `Schedule<A, C>` with companion `Query`, `Intent`, `materialize`,
`enqueue` operations. The intent is to make agenda-style use cases (calendars,
settler bots, dashboards of pending transitions) ergonomic by default.

Schedule-first fails both criteria:

- **Not minimum sufficient.** A `Schedule` is mechanically derivable from
  existing primitives:
  `Schedule(s, t) = { current: s, due: View.nextPending(s, t), upcoming: derived(s, t, ...) }`.
  Promoting a derivable composition to primitive status duplicates surface area
  without expanding what is expressible.
- **Not orthogonal.** `Schedule` is a particular composition of `View` and
  `Action`. Two primitives in the kernel that name the same compositional fact
  pull the design in incompatible directions whenever a new capability arrives.

The cost of accepting a higher-abstraction primitive is structural, not
aesthetic: each level of abstraction baked into the kernel is a *prediction
about future use cases*. Predictions optimise for the anticipated and
foreclose the unanticipated. For ideas not yet imagined — the only category
of idea whose support cannot be retrofitted — the kernel must sit at the
lowest non-trivial level.

Concretely, mapping ideas to designs:

| Capability                            | Four-primitive kernel             | Schedule-first kernel              |
| ------------------------------------- | --------------------------------- | ---------------------------------- |
| Marketplace listings (cross-escrow)   | `escrows.map(View.toListing)` — trivial. | Listings are not schedule-shaped; overhead. |
| Keeper bot                            | `if View.hasPending → fire`.      | `if Schedule.due.length → fire`. ≈ tie. |
| Agenda dashboard (N escrows)          | Consumer reconstructs agenda from `nextPending` per escrow. | Native: `schedules.flatMap(s => s.upcoming)`. |
| Time-travel / what-if analyzer        | Native — exactly what `(state, t) → state'` is. | Forces Schedule recomputation per time-jump. |
| Off-chain protocol replay / testbed   | Native pure fold over actions.    | Pays Schedule reconstruction cost at each step. |
| Cross-protocol composition (lending, AMM, oracle) | `State` / `View` / `Action` have cognates in every Sui protocol. | `Schedule` is usufruct-specific; composition breaks at the border. |
| Unanticipated capability X            | Composes from §4 primitives.      | Must be schedule-shaped, or break the abstraction. |

The four-primitive kernel loses on exactly one category — agenda
dashboards — and wins on every category where the use case is not
schedule-shaped, including the entire "ideas not yet imagined" class.

The agenda-ergonomics gap is closed by **convenience layers** (§7.2), which
compose the primitives in canonical ways without contaminating the kernel.
`Schedule` ships as one such layer: opt-in, hand-written, explicitly built atop
`View` and `Action`. The result: agenda ergonomics where they help, full
expressive ceiling preserved everywhere else.

The discipline this imposes:

> If a future capability requires extending the four primitives rather than
> adding a convenience layer, the design has failed.

Every accommodation is pushed outward into convenience packages, never inward
into the kernel. The kernel exists at the lowest non-trivial level and stays
there.

### §7.2 — The high-level API (Layer 2)

The developer-facing API — `usufruct()` and the capability **handles** (`Escrow`,
`UsufructCap`, `GovernanceCap`, `EarningsInbox`, `ProtocolFeeInbox`) — is the
**canonical convenience layer**: the productized composition of §7. It is governed
by this spec, not exempt from it.

**Composition law.** Every handle member is a composition of the four primitives —
nothing else. Reads route through the `Reader` (the on-chain `View` surface, §6.1);
writes through `Action.toPtb`; discovery/history/streaming through `Source`. The
handle adds only *ergonomics*: batching a fetch into a coherent snapshot, resolving
rich types (`Price`/`Date` from `Mist`/`Ms` + on-chain `CoinMetadata`), and the
object-centric routing below. If a handle method requires new core code (not a
composition of `EscrowState`/`View`/`Action`/`Source`), the design has failed —
the same discipline §7.1 imposes on the kernel.

**Drift-zero by construction.** Layer 2 lives in the core package
(`@usufruct-protocol/sdk`) and reads *everything effective* through the `Reader`,
so it inherits drift-zero (§12): it never re-derives the contract's logic. The
off-chain mirror (`@usufruct-protocol/sim`) is reached explicitly, never by a
core handle.

**Object-centric law.** Authority is **possession** of a bearer object, so both
reads and writes live on the object whose question or right they are — you ask the
object you hold. A write is a method on its receiver (`usufructCap.burn()`,
`governanceCap.updateMarket()`); a read is likewise scoped to its subject
(`escrow.status`, `usufructCap.state()`, `governanceCap.governs(escrow)`). A view
parameterized by another object's id is projected onto that object's handle and
**role-gated** — `usufructCap.state()` reports the seat's economics only while the
cap holds the seat, else `null` (honest possession, never another seat's data).
`transfer` is first-class: moving the object moves the role.

**The four verbs.** The whole surface reduces to read · write · inspect · react —
`Reader`/snapshot · `Action.toPtb` · `Source` pull (events/discovery) · `Source`
push (gRPC firehose). Each is one of the primitives; none is new core.

---

## §8 — Critical invariant (binds tier 2 only)

> **Every `View` / `Action.step` the SDK *ships in the opt-in mirror* (§6.2)
> produces output bit-exact with the deployed bytecode at the same
> `(state, t)`. The on-chain view (tier 1) is the oracle; the mirror is
> tested against it. A mirror that cannot meet this bar is not shipped —
> the consumer reads through the wrapper instead.**

This invariant does **not** bind tier 1: the wrapper *is* the bytecode's
answer, so there is nothing to be bit-exact *with*. The invariant exists to
keep the opt-in mirror honest, and it is enforceable precisely because tier 1
gives every mirrored value a free, authoritative oracle (§8.2).

The invariant is **unconditional**: the protocol carries no stochastic
policy. Every transition is a deterministic fixed-point integer computation
over `(state, t)` — the credit/auction curves, the bps settlement split, the
price escalation. There is no `&Random` consumption, no seeded `Rng`, no
"one possible future". `Action.step` is therefore a total deterministic
function, and `toPtb` and `step` produce identical observable effects at the
same `(state, t)`.

If the invariant holds for a given action, `Action::step` is well-defined for
that action over every state. The simulator, testbed, and agenda capabilities
depend on it for the actions they touch.

### §8.1 — The curve math is the hard part

The only non-trivial mirror work is reproducing the fixed-point curve and
settlement arithmetic bit-exactly. The discipline:

- The math is mirrored in `src/sim/curve.ts` from `curve_shape_policy.move`
  and `math.move`, in `bigint`, respecting u128 widening, **truncating**
  division, and the exact denominators (`SCALE = 1e9`, `TAYLOR_SCALE = 1e18`,
  `BPS_DENOMINATOR = 10000`) and constant tables (`EXP_A_NORM_*`, logistic).
- Two actions consume it: `rent` (descending floor over `auction_shape`,
  Descent branch) and `applyPendingTransitionStates` (used-credit integral
  over `credit_shape`, handover branch). The rest — `rent` bid/install-idle,
  `retire`, `claimAsset` — are pure state-machine moves with no curve.

### §8.2 — Mitigation of bit-exactness drift

Without a verification mechanism, "bit-exact mirror" is a promise, not a fact.
The discipline that converts promise to fact:

- **Curve golden vectors.** The protocol's own pinned test vectors
  (`tests/policies/curve_shape_policy_tests.move`) are lifted into a
  TypeScript golden test asserting `src/sim/curve.ts` reproduces every
  `(shape, params, t, t_max) → height` bit-exactly. Every `CurveShape` and
  `PriceEscalation` variant is covered.
- **Live integration parity.** The on-chain public views (`floor_price_mist`,
  `accrued_credit_mist`, `handover_settlement`, `tenure_settlement`) — already
  the `read` tier — are evaluated over real states and asserted equal to the
  mirror; and `apply.step` over a live handover is asserted bit-exact against
  the refetched post-transition state. `apply.step` settles **both**
  credit-consuming transitions: the handover (partial, curve-derived, with a
  refund) and the tenure expiry (full stake, no refund) — the latter triangulated
  live `apply.step.tenureSettlement == tenure_settlement view == EarningsMessagePosted.amount`.
  **Multi-tenure** (`committed_tenures > 1`) keeps the protocol's split: the
  settlement is `splitFee(`*full* stake`)` (the stake is the total across all
  committed tenures) while the *price* — the next auction's `last_acq_price`, and
  a handover's `new_rent_price` — is `stake_per_tenure` (per-tenure). Verified
  offline (a 2-tenure expiry settles 2000 → 1800/200, per-tenure price 1000) and
  live (a 2-tenure rent: `splitFee(stake) == tenure_settlement view`).
- **CI enforcement.** A Move source change that alters output without a
  corresponding TypeScript change breaks the golden test in CI.

If a view or action does not have a golden test, it does not ship in mirror
(`step` / pure `View`) form; the consumer reads it through the wrapper
(`read`, §6.1) until a golden test is added. Because the wrapper is the
default and already complete, "no golden test yet" degrades gracefully to
"use the on-chain answer" — never to a missing capability.

---

## §9 — Non-goals

- **Auto-generating Views and Actions from Move ABI.** The codegen layer
  (§4.5) is mechanical and intentionally thin. Views and Actions encode
  invariants (collapsing enum predicates, composing PTB chains, threading
  hot-potato types) that mechanical generation cannot express. Codegen is L1
  only; L2/L3 are hand-written.
- **A mirror-first default.** Making the TypeScript mirror the default read
  path (the prototype's original choice) re-implements the contract's read
  logic in the client and re-introduces the drift this design exists to
  avoid. The wrapper is the default; the mirror is opt-in (§6, §2.1). This
  does *not* forfeit the simulator/testbed/agenda — those are exactly what
  the opt-in mirror provides; it only stops paying drift risk for the common
  one-shot read, which the wrapper answers from the bytecode directly.
- **Encapsulating state in classes.** Forbidden by §3. Adding a method to
  `EscrowState` requires amending §3.
- **Hiding time.** Forbidden by §3. Any function that needs time accepts it
  as a parameter.
- **A monolithic SDK surface.** The four primitives plus codegen are the
  core. Convenience layers (settler runtime, calendar widgets, marketplace
  query helpers) are downstream packages that compose the core; they are not
  features of the core.

---

## §10 — Risks and mitigations

| Risk                                                                                    | Mitigation                                                                                     |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Bit-exactness drift between TS `Action::step` / `View` and Move semantics.              | Cross-runtime golden tests (§8.2). No `step` ships without coverage.                           |
| `Asset: key + store` has user-defined BCS layout the SDK cannot know in advance.        | `EscrowState<A>` parameterised by integrator-supplied BCS schema, which is **required** for any asset richer than `{ id: UID }` (`uidAssetSchema` covers only that shape). A blind `Uint8Array` fallback is impossible: the asset sits mid-struct inside `AssetCustodyOpen/Locked`, and BCS is not self-describing, so a wrong schema misaligns every subsequent field *silently* (observed live on testnet, 2026-06-12, decoding `DummyAsset { id, uses }` as uid-only). The decode invariant — `serialize(parse(bytes))` must reproduce the original bytes, else `EscrowDecodeError` — converts that silent corruption into an immediate failure. |
| Move source evolves; TypeScript drifts silently.                                        | Codegen regenerated on `sui move build`; type errors in hand-written layer pinpoint changes.   |
| Pattern A reliance accumulates if golden tests are deferred.                            | Golden test coverage is the prerequisite for moving any view from Pattern A to Pattern B.      |
| Collecting from a coin-polymorphic inbox with a `Receiving<…<C>>` ticket whose target object is a different coin → opaque `0x2::transfer::receive_impl` abort (code 2), not a protocol error; Move can't pre-check a `Receiving<T>`'s target type. | Collect `Action` discovers the coin types present in the inbox and emits one collect PTB per `C`, filtering tickets by the fully-qualified `EarningsMessage<C>` / `FeeMessage<C>` type, so a mismatched ticket is never built (§5.2). Confirmed live in the v1.4.2 audit. |

---

## §11 — Repository layout

The SDK is a workspace monorepo, split across the **drift-zero seam** (the §12
2026-06-16 decision; Phase B is the physical move below). The dependency arrow is
**sim → sdk** — the mirror imports the core, never the reverse:

```
usufruct/                 # Move package (existing)
  sources/
  tests/
  Move.toml

packages/
  sdk/                    # the drift-zero CORE (@usufruct-protocol/sdk)
    src/
      read/               # the default read: the Reader over on-chain views
        spec.ts           #   view-spec table (call + BCS decode) — single source
        reader.ts         #   createReader → typed Reader + snapshot()
      codegen/            # ❺ auto-generated; do not edit by hand — used by both packages
        types.ts / bcs.ts / calls.ts
      actions/            # write path: Action.toPtb (the core's PtbAction surface)
      highlevel/          # Layer 2 handles (usufruct, escrow, cap, …) — Reader-based
      config/             # DSL config builder
      primitives/         # CORE primitives: EscrowSnapshot + Source, Action.toPtb
        snapshot.ts       #   raw EscrowSnapshot (ids + type tag + BCS bytes)
        action.ts         #   PtbAction = { toPtb }
        source.ts         #   Source interface + ChainSource impl
  sim/                    # the opt-in MIRROR (@usufruct-protocol/sim) — sim → sdk
    src/
      primitives/         # EscrowState + decodeEscrowState, View<T>, lifecycle step-types
      views/              # hand-written View<T> functions (one file per banner)
      sim/                # Action.step + curve.ts (the only thing that can drift)
SPEC.md                   # this document
fixtures/                 # cross-runtime golden fixtures (the mirror's oracle = the Reader)
test/                     # tests; parity-cases.ts imports the core's read spec
```

The core surface: `read` (default), `actions` (`Action.toPtb` write path), plus the
Layer 2 handles — all Reader-based, so drift-zero. The mirror surface: `EscrowState`
+ `decodeEscrowState`, the compute `View`s, and `Action.step` — opt-in. The `read`
spec table is the *single* source of the on-chain decode logic; the golden/parity
tests import it as the oracle, so the wrapper and the test that keeps the mirror
honest are the same code.

Further convenience layers (settler runtime, marketplace helpers, etc.) ship as
additional workspace packages alongside `sdk`/`sim`.

---

## §12 — Decision log

| Decision                                                                            | Status      | Rationale                                                                                          |
| ----------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------- |
| Language: TypeScript on `@mysten/sui`.                                              | Adopted     | Canonical Sui SDK ecosystem; matches integrator expectations.                                      |
| Four primitives only; capabilities emerge.                                          | Adopted     | Closure under composition; verified by tracing §7.                                                 |
| Pattern B (TypeScript mirror) default, Pattern A for curve/settlement math.         | **Superseded (2026-06-12)** | The prototype made the off-chain mirror the default read path; that re-derives the contract's read logic in the client and re-introduces drift — the very failure this design names in §2. The 128-case parity harness was the *cost* of the duplication, not a feature. Superseded by the row below. |
| Thin wrapper over on-chain views = default read; TS mirror = opt-in.                | Adopted (2026-06-12) | The protocol's views are pure, total, source-verified, and `&Clock`-free (every time-dependent view takes `now_ms: u64`). So a `simulateTransaction` read has drift = 0 by construction *and* keeps time-travel for any caller-supplied `t`; it forgoes only hypothetical-state evaluation, which is exactly what the opt-in mirror adds. `read` (`createReader`) is the default surface; `sim` (the mirror) is opt-in for local computation. The on-chain views become the explicit golden oracle the mirror is tested against (§8), and the wrapper's decode table is the single source both consume. See §2.1, §6. |
| Codegen for L1 (types + BCS + bare calls) only.                                     | Adopted     | Mechanical layer benefits from codegen; semantic layer does not.                                   |
| Auto-generate the entire SDK from Move ABI.                                         | Rejected    | Loses composition invariants encoded in PTB chains (e.g. `IntegrationConfig`).                     |
| Mirror everything in TypeScript, no `devInspect`.                                   | Rejected    | Curve / settlement math drift risk is real; selective Pattern A is the established mitigation.     |
| Schedule-first kernel (5th primitive for pending-transitions agenda).               | Rejected    | `Schedule` is derivable from `View` + `Action`; promoting it duplicates surface without expanding expressiveness. Higher-abstraction primitives predict use cases and foreclose unanticipated ones. Agenda ergonomics live as convenience layers (§11). See §7.1. |
| Methods on `EscrowState`.                                                           | Rejected    | Violates §3; closes off time-travel and replay; encourages hidden state.                           |
| Implicit ambient clock (`now()` helper).                                            | Rejected    | Violates §3; closes off simulator and testbed.                                                     |
| Modelling stochastic policies (`RandomInRange`, seeded `Rng`, `StepOpts`).          | Removed (2026-06-13) | The protocol's stochastic-policy feature was removed upstream; the runtime is now fully deterministic. The SDK drops `Rng`/`StepOpts` and the §8.1 stochastic machinery — `step` is unconditionally `(state, t)`. |
| Surfacing `&Clock` / `&mut TxContext` as SDK-visible parameters.                    | Rejected    | FFI artefacts of Move signatures, not semantic inputs. The SDK injects the `0x6` clock singleton at `toPtb` time; `TxContext` is supplied by the Sui transaction runtime. |
| `Uint8Array` fallback for unknown asset BCS layouts.                                | Rejected (amended 2026-06-12) | Refuted by the prototype: the asset sits mid-struct, so decoding requires the exact schema; a wrong schema misaligns silently. Replaced by required integrator schema + `uidAssetSchema` for uid-only assets + re-serialize byte-compare decode invariant (`EscrowDecodeError`). See §10. |
| Inspect functions as the named category for Pattern A reads.                        | Superseded (2026-06-12) | Generalised: Inspect functions were the prototype of the wrapper. They became the `read` tier (§6.1) covering *all* views, not a selective category. `src/views/inspect.ts` is absorbed into `src/read/`. |
| Broad §5.1 collapse: `*_kind` views and cycle-params accessors fold into unions/records. | Adopted (2026-06-12) | ~68 TypeScript views cover the ~124 Move views; the unrolled API is reconstruction material for the parity oracle only. 128 live parity cases (64 × idle/occupied states) verified on testnet. |
| Action variants generic over the state aggregate (`Action<R, P, S = EscrowState>`).  | Adopted (2026-06-12) | Inbox actions transition over `MessageGroups`, which fits none of the escrow lifecycle slots. Genericity preserves the three-variant kernel without a fifth primitive and gives inbox actions a real pure `step` (testbed-able). |
| Drift-zero core; the mirror ships as a separate `@usufruct-protocol/sim` package, not in core. | Adopted (2026-06-16) | The core must be *drift-zero by construction*, not merely by default: it only decodes BCS, does IO via `Source`, reads effective values through the on-chain `Reader` (§6.1), and builds PTBs via `Action.toPtb` (a `PtbAction` — toPtb only). It never re-derives the contract's math, so its sole failure surface is the BCS decode (guarded by §10). The mirror (`Action.step`, the compute `View<T>` functions, `sim/curve.ts`, `MemorySource`/`memoryInbox`) — the only thing that *can* drift — moves to a sibling package depending one-way on core (the §11 convenience-layer thesis, now applied to the kernel split). **Enabling precondition (§2.1):** this is only possible because the protocol exposes its *entire runtime* as ~124 pure, total, `&Clock`-free views — the core can answer every effective value on-chain with drift zero. A protocol without that surface (dynamic-field/oracle/cross-object state) could not have a drift-zero core; the mirror would be its default and drift unavoidable. The drift-zero core is downstream of that single fact. **Purist, not pragmatic:** the core reads *every* effective value through the `Reader`, never off a fetched field, because lazy transitions make a stored field and its effective value at `t` diverge — computing the effective value *is* the mirror; `Reader.snapshot({t})` batches the cost away. The on-chain views remain the mirror's golden oracle (§8). Verified: the core compiles with the mirror entirely excluded (`tsconfig.core.json`), the import graph has no core→mirror runtime edge, Layer 2 (already Reader-based) is unaffected, 434 offline tests green. Phase A (this change) is the in-place refactor; the physical monorepo move (`packages/sdk` + `packages/sim`) is Phase B. |

---

## §13 — Related references

- `usufruct/sources/escrow.move` — the public surface this SDK targets.
- `ARCHITECTURE.md` — the protocol's structural overview.
- `CODE-PRINCIPLES.md` — the conventions that produced the functional style this
  SDK transcribes.

External:

- `@mysten/sui` v2 — Sui TypeScript SDK; the foundation this SDK builds on.
  Breaking changes in v2: `SuiClient` (from `@mysten/sui/client`) is replaced
  by three concrete clients — `SuiGrpcClient` (`@mysten/sui/grpc`, recommended),
  `SuiJsonRpcClient` (`@mysten/sui/jsonRpc`), and `SuiGraphQLClient`.
  `getFullnodeUrl` → `getJsonRpcFullnodeUrl`. SDK maintainers should accept
  `ClientWithCoreApi` to remain transport-agnostic.

  ```ts
  // v2 — recommended transport
  import { SuiGrpcClient } from '@mysten/sui/grpc';
  const client = new SuiGrpcClient({ network: 'mainnet', baseUrl: '…' });
  ```
