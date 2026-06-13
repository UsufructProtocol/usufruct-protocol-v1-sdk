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

The four primitives (§4) describe **tier 2**. Tier 1 needs no new primitives:
it is generated calls plus IO. The error most SDKs make — re-implementing the
contract's read logic in the client, then drifting from it — is avoided by
making tier 1 the default and confining tier 2's re-derivation to the cases
that genuinely need off-chain computation.

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

### §4.1 — `EscrowState<A, C>` (data)

The BCS-decoded snapshot of an `Escrow<Asset, CoinType>` shared object,
including its full `AssetContext` subtree.

Properties:

- Immutable (TypeScript `readonly` at the type level).
- Serializable (it is itself the result of BCS decoding).
- Contains no reference to an RPC client, clock, or event stream.
- Parameterized over `A` (asset BCS schema) and `C` (coin type marker).

`EscrowState` is the *only* data shape that views and actions consume. It is
the SDK's representation of "what the chain currently knows about this escrow".

### §4.2 — `View<T>` (read)

```
View<T> = (state: EscrowState, t: Ms) => T
```

Free function. One `View` per public view function in `usufruct/sources/escrow.move`.

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
interpretations of a single semantic operation:

- `step` — off-chain pure interpretation. Given current state and time,
  return next state and result. Used by simulator, testbed, calendar.
- `toPtb` — on-chain interpretation. Append the corresponding Move call to a
  `Transaction`. Used by live execution.

Every public mutating function of `usufruct` is classified by its lifecycle
role, which determines its `Action` variant:

```
interface OriginAction<R, P> {        // creates an EscrowState
  step:  (t: Ms, opts?: StepOpts) => { state: EscrowState; result: R };
  toPtb: (tx: Transaction, args: P) => R_ptb;
}
interface TransitionAction<R, P> {    // mutates an EscrowState
  step:  (state: EscrowState, t: Ms, opts?: StepOpts) => { state: EscrowState; result: R };
  toPtb: (tx: Transaction, args: P) => R_ptb;
}
interface TerminalAction<R, P> {      // consumes an EscrowState
  step:  (state: EscrowState, t: Ms, opts?: StepOpts) => { result: R };
  toPtb: (tx: Transaction, args: P) => R_ptb;
}

interface StepOpts {
  rng?: Rng;   // required only when state's config triggers stochastic resolution (§8.1)
}
```

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

`&Random`, `&Clock`, and `&mut TxContext` appear in Move signatures but are
FFI artefacts, not semantic inputs. The SDK injects the `0x8` randomness and
`0x6` clock singletons automatically at `toPtb` time; none of them appears in
any `Action` constructor. Whether `step` requires an `Rng` is a property of
the state's config, not of the action's type — see §8.1.

### §4.4 — `Source` (IO)

```
interface Source {
  fetch:     (id: Id<Escrow>) => Promise<EscrowState>;
  subscribe: (id: Id<Escrow>) => Observable<EscrowState>;
  query:     (predicate: Predicate) => AsyncIterable<EscrowState>;
}
```

The single point of impurity in the SDK. All network IO is mediated through
`Source` implementations:

- `ChainSource(client)` — `getObject` for fetch; event subscription scoped
  to `escrow_id` for subscribe; either RPC pagination or indexer for query.
  In `@mysten/sui` v2, `client` is a `SuiGrpcClient` (recommended) or
  `SuiJsonRpcClient`. `SuiClient` was renamed in v2; the import path
  `@mysten/sui/client` was removed.
- `IndexerSource(url)` — read-optimised paths for historical and aggregate
  queries. In `@mysten/sui` v2, `SuiGraphQLClient` (`@mysten/sui/graphql`) is
  the natural transport here: it supports flexible field selection, filtered
  queries ("all escrows owned by address X", "events on escrow Y over N days"),
  and cursor-based pagination without the verbosity of JSON-RPC pagination.
  `ChainSource` does not benefit from GraphQL; `IndexerSource` is where it
  earns its place.
- `MemorySource()` — in-memory implementation used by testbed; alimenta
  `EscrowState` from a local store that `Action.step` updates.

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
| Simulator / time-travel             | `Source::fetch` → `EscrowState`; then `View(state, t)` and `Action::step(state, t).state` chain.  |
| Settler bot                         | `View=nextPending` returns `t*`; timer fires `ApplyPendingTransitionStates::toPtb` + execute.     |
| Calendar / temporal index           | Iterate `nextPending` + `step(ApplyPendingTransitionStates)` recursively until horizon.           |
| Reactive single-writer state        | `Source::subscribe(id)` emits new `EscrowState`. Between emissions, `View(state, t)` is correct.  |
| Whole-protocol off-chain testbed    | Substitute `Source = MemorySource()`. Identical `View` and `Action` code; no chain touched.       |
| Asset-agnostic marketplace          | `Source::query(byOwner(addr))` returns `AsyncIterable<EscrowState<A, C>>`; the SDK is asset-agnostic. |
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

The agenda-ergonomics gap is closed by **convenience layers** (§11 packages),
which compose the primitives in canonical ways without contaminating the
kernel. `Schedule` ships as the first convenience layer: opt-in, hand-written,
explicitly built atop `View` and `Action`. The result: agenda ergonomics
where they help, full expressive ceiling preserved everywhere else.

The discipline this imposes:

> If a future capability requires extending the four primitives rather than
> adding a convenience layer, the design has failed.

Every accommodation is pushed outward into convenience packages, never inward
into the kernel. The kernel exists at the lowest non-trivial level and stays
there.

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
gives every mirrored value a free, authoritative oracle (§8.2). When the
state's configuration declares stochastic policies (`RandomInRange`), the
mirror's `step` is parameterised by an optional `Rng` and is bit-exact under
equivalent seeding; `toPtb` is always authoritative regardless.

If the invariant holds for a given action, `Action::step` is well-defined for
that action over every (deterministically-configured) state. The simulator,
testbed, and agenda capabilities depend on it for the actions they touch.

Determinism is a property of the **state's config**, not of the **action's
type**. The same `rent` action is deterministic over a state whose tenure
policy is `Fixed`, and stochastic over a state whose tenure policy is
`RandomInRange`. The SDK exposes this distinction through views over state
(`views.tenureCeilingIsRandomInRange(state)`,
`views.minRentPriceIsRandomInRange(state)`, …) — never through type-level
markers on actions.

### §8.1 — Stochastic state transitions

The Move signatures of `integrate`, `rent`, `applyPendingTransitionStates`,
and others include `&Random`, but this is an FFI artefact: the parameter is
passed unconditionally because Move signatures are fixed regardless of runtime
branching. Randomness is only **consumed** when the state's
`IntegrationConfig` declares policies whose resolution is stochastic — at
present, `tenure_ceiling: RandomInRange { min, max }` and
`min_rent_price: RandomInRange { min, max }`.

A `TransitionAction::step` over such a state samples those resolutions:

- In testbed and golden-test contexts, `StepOpts.rng` is seeded; the resulting
  sample is reproducible and matches the Move equivalent under equivalent
  seeding (the `*_for_testing_with_seed` helpers in Move exist for this).
- In production simulator contexts, `StepOpts.rng` may be omitted; the SDK
  uses a contextually-appropriate default (e.g. system RNG for "what could
  happen" exploration). The result is one possible future, not a contractual
  prediction.
- `Action::toPtb` is always authoritative; randomness is resolved on-chain at
  execution time regardless of any `step` sample preceding it.

The SDK does not mark stochasticity in the type of the action. Consumers that
need to know whether a given `(state, action)` pair will resolve randomly
read it from views over `state`, never from types over the action.

### §8.2 — Mitigation of bit-exactness drift

Without a verification mechanism, "bit-exact mirror" is a promise, not a fact.
The discipline that converts promise to fact:

- **Cross-runtime golden tests.** A Move fixture emits tuples
  `(state, t) → expected_result` covering every `View` and every non-random
  `Action::step`. A TypeScript test consumes the fixture and asserts the
  TypeScript implementation produces identical results.
- **CI enforcement.** A Move source change that alters output without a
  corresponding TypeScript change breaks the golden test in CI.
- **Curve coverage.** Every parameter combination for `CurveShape` and
  `PriceFunction` is exercised explicitly in fixtures.

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

The SDK lives at the repository root as a sibling of the Move package:

```
usufruct/                 # Move package (existing)
  sources/
  tests/
  Move.toml

sdk/                      # TypeScript SDK (this branch and onward)
  SPEC.md                 # this document
  package.json
  src/
    read/                 # TIER 1 (default): thin wrapper over on-chain views
      spec.ts             #   view-spec table (call + BCS decode) — single source
      reader.ts           #   createReader → typed Reader + snapshot()
    codegen/              # ❺ auto-generated; do not edit by hand — used by both tiers
      types.ts / bcs.ts / calls.ts
    actions/              # write path: Action.toPtb (+ opt-in step, tier 2)
    config/               # DSL config builder
    primitives/           # TIER 2 (opt-in) kernel — the four primitives
      state.ts            # ❶ EscrowState type and BCS decoding
      view.ts             # ❷ View<T> type alias
      action.ts           # ❸ Action<R> variants (step + toPtb)
      source.ts           # ❹ Source interface + ChainSource impl
    views/                # hand-written View<T> functions (the mirror), one file per banner
    sim/                  # facade re-exporting the tier-2 mirror (views + state + step)
  fixtures/               # cross-runtime golden fixtures (the mirror's oracle = tier 1)
  test/                   # tests; parity-cases.ts imports src/read/spec.ts
```

The package surface: `read` (default), `actions` (write), `sim` (opt-in
mirror). The `read` spec table is the *single* source of the on-chain decode
logic — the golden/parity tests import it as the oracle, so the wrapper and
the test that keeps the mirror honest are the same code.

Convenience layers (settler runtime, marketplace helpers, etc.) ship as
distinct packages under `sdk/packages/` once core stabilises.

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
| Type-level marker `Probabilistic<T>` on actions that consume `&Random` in Move.     | Rejected    | Leaks an FFI artefact into the SDK type system. Determinism is a property of the state's config, not of the action's type. Stochasticity is read from views over state (§8.1), not from action types. |
| Surfacing `&Random`, `&Clock`, `&mut TxContext` as SDK-visible parameters.          | Rejected    | These are FFI artefacts of Move signatures, not semantic inputs. The SDK injects the `0x8` and `0x6` singletons at `toPtb` time; `TxContext` is supplied by the Sui transaction runtime. |
| `Uint8Array` fallback for unknown asset BCS layouts.                                | Rejected (amended 2026-06-12) | Refuted by the prototype: the asset sits mid-struct, so decoding requires the exact schema; a wrong schema misaligns silently. Replaced by required integrator schema + `uidAssetSchema` for uid-only assets + re-serialize byte-compare decode invariant (`EscrowDecodeError`). See §10. |
| Inspect functions as the named category for Pattern A reads.                        | Superseded (2026-06-12) | Generalised: Inspect functions were the prototype of the wrapper. They became the `read` tier (§6.1) covering *all* views, not a selective category. `src/views/inspect.ts` is absorbed into `src/read/`. |
| Broad §5.1 collapse: `*_kind` views and cycle-params accessors fold into unions/records. | Adopted (2026-06-12) | ~68 TypeScript views cover the ~124 Move views; the unrolled API is reconstruction material for the parity oracle only. 128 live parity cases (64 × idle/occupied states) verified on testnet. |
| Action variants generic over the state aggregate (`Action<R, P, S = EscrowState>`).  | Adopted (2026-06-12) | Inbox actions transition over `MessageGroups`, which fits none of the escrow lifecycle slots. Genericity preserves the three-variant kernel without a fifth primitive and gives inbox actions a real pure `step` (testbed-able). |

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
