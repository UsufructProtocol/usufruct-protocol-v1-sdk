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

---

## §3 — Core design principle

> **State is data, not object. Action is value, not method. Time is parameter,
> not context.**

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

The SDK uses a hybrid read pattern, with the split determined per view by
whether the computation is mathematical (curves, settlement bps splits) or
structural (field access, simple arithmetic).

### §6.1 — Pattern B (fetch + TypeScript mirror) — default

For views that are field reads, predicates, identity comparisons, or simple
arithmetic over timestamps and stakes, the SDK fetches `EscrowState` once and
evaluates the view as a pure TypeScript function. No `devInspect` round-trip.

This covers approximately 80% of the read surface in `escrow.move`:

- State predicates (`is_idle`, `is_at_dutch_auction`, `is_active`, …).
- Identity views (`asset_id`, `owner_cap_id`, `current_tenant_addr`, …).
- Stake views (`current_stake`, `pending_stake`).
- Temporal views (`phase_start_ms`, `tenure_expiry_ms`, …).
- Cap views (`owner_cap_is_valid`, `tenant_cap_status`, …).
- Config views (curves shape, policy shape, alphas).

### §6.2 — Pattern A (`devInspect` / `simulateTransaction`) — selective

For views that evaluate curves (`smoothstep`, `logistic`, `power_law`,
`exponential`) or settlement splits with bps rounding, the SDK invokes the
on-chain Move view via `devInspect` and decodes the BCS return value.

This covers the `compute_*` and `evaluate_*` views in `escrow.move`:

- `compute_floor_price`, `compute_floor_price_at_ms`.
- `compute_used_credit`, `compute_used_credit_at_ms`.
- `compute_next_ascending_floor`.
- `compute_handover_settlement`, `compute_tenure_settlement`.
- `compute_handover_expiry_at`.

Pattern A is chosen here not for correctness reasons but to eliminate drift
risk: replicating fixed-point curve math bit-exactly across runtimes is
maintenance liability that does not pay for itself when the on-chain call is
cheap and deterministic. (See §8 mitigation 1 for the cross-runtime golden
test discipline that applies *if* Pattern B is later chosen for any of these.)

#### §6.2.1 — Inspect functions

Pattern A reads have a named category: **Inspect functions**. An Inspect
function is IO with the shape

```
(client: ClientWithCoreApi, target, t: Ms) => Promise<T>
```

living in `src/views/inspect.ts`. The discipline:

- An Inspect function is **not** a `View<T>` — it cannot be, because it
  performs IO — and it is **not** a fifth primitive. It is the on-chain
  evaluation of a view the SDK chooses not to mirror (§6.2 rationale).
- The client enters by parameter, never ambiently — the same principle as
  time-as-parameter (§3). Nothing downstream captures a client.
- One Inspect function per Pattern A view; constructed from the codegen call
  wrapper plus `simulateTransaction` BCS return-value decoding.
- Moving a view from Pattern A to Pattern B (golden-test gated, §8.2)
  replaces its Inspect function with a `View<T>` of the same name; the
  Inspect form is then deleted, not kept as a parallel path.

Validated in the prototype: `floorPriceMist` and `accruedCreditMist` shipped
as Inspect functions with no pressure on the four-primitive kernel.
(Chain-observed: `accrued_credit_mist` aborts on a non-rented escrow — an
Inspect function surfaces the protocol's own abort, which is the intended
behaviour, not an SDK defect.)

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

## §8 — Critical invariant

> **Every public operation of `usufruct` admits a TypeScript semantics
> `(state: EscrowState, t: Ms, opts?: StepOpts) => state'` whose output is
> bit-exact with the Move runtime when the state's configuration is fully
> deterministic. When the state's configuration declares stochastic policies
> whose resolution is triggered by the operation, the TypeScript semantics is
> parameterised by an optional `Rng` and is bit-exact under equivalent seeding.**

If this invariant holds, `Action::step` is well-defined for every action over
every state. The simulator, testbed, calendar, and reactive capabilities all
depend on it.

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

If a view or action does not have a golden test, it does not ship in `step`
form; it must use Pattern A (`devInspect`) until a golden test is added.

---

## §9 — Non-goals

- **Auto-generating Views and Actions from Move ABI.** The codegen layer
  (§4.5) is mechanical and intentionally thin. Views and Actions encode
  invariants (collapsing enum predicates, composing PTB chains, threading
  hot-potato types) that mechanical generation cannot express. Codegen is L1
  only; L2/L3 are hand-written.
- **Pattern A everywhere.** Doing so would forfeit the time-travel,
  simulator, and testbed capabilities and would yoke every UI to an RPC
  round-trip per view. The hybrid (§6) is normative.
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
    primitives/           # the four primitives + codegen plumbing
      state.ts            # ❶ EscrowState type and BCS decoding
      view.ts             # ❷ View<T> type alias + view function exports
      action.ts           # ❸ Action<R> type + concrete action constructors
      source.ts           # ❹ Source interface + ChainSource impl
    codegen/              # ❺ auto-generated; do not edit by hand
      types.ts
      bcs.ts
      calls.ts
    views/                # hand-written View<T> functions, one file per banner
    actions/              # hand-written Action constructors
    config/               # DSL config builder (emergent capability §7)
  fixtures/               # cross-runtime golden test fixtures
  test/                   # TypeScript-side tests consuming fixtures
```

Convenience layers (settler runtime, marketplace helpers, etc.) ship as
distinct packages under `sdk/packages/` once core stabilises.

---

## §12 — Decision log

| Decision                                                                            | Status      | Rationale                                                                                          |
| ----------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------- |
| Language: TypeScript on `@mysten/sui`.                                              | Adopted     | Canonical Sui SDK ecosystem; matches integrator expectations.                                      |
| Four primitives only; capabilities emerge.                                          | Adopted     | Closure under composition; verified by tracing §7.                                                 |
| Pattern B default, Pattern A for curve/settlement math.                             | Adopted     | §2 analysis of Sui DeFi SDK patterns. Matches risk profile of the math involved.                   |
| Codegen for L1 (types + BCS + bare calls) only.                                     | Adopted     | Mechanical layer benefits from codegen; semantic layer does not.                                   |
| Auto-generate the entire SDK from Move ABI.                                         | Rejected    | Loses composition invariants encoded in PTB chains (e.g. `IntegrationConfig`).                     |
| Mirror everything in TypeScript, no `devInspect`.                                   | Rejected    | Curve / settlement math drift risk is real; selective Pattern A is the established mitigation.     |
| Schedule-first kernel (5th primitive for pending-transitions agenda).               | Rejected    | `Schedule` is derivable from `View` + `Action`; promoting it duplicates surface without expanding expressiveness. Higher-abstraction primitives predict use cases and foreclose unanticipated ones. Agenda ergonomics live as convenience layers (§11). See §7.1. |
| Methods on `EscrowState`.                                                           | Rejected    | Violates §3; closes off time-travel and replay; encourages hidden state.                           |
| Implicit ambient clock (`now()` helper).                                            | Rejected    | Violates §3; closes off simulator and testbed.                                                     |
| Type-level marker `Probabilistic<T>` on actions that consume `&Random` in Move.     | Rejected    | Leaks an FFI artefact into the SDK type system. Determinism is a property of the state's config, not of the action's type. Stochasticity is read from views over state (§8.1), not from action types. |
| Surfacing `&Random`, `&Clock`, `&mut TxContext` as SDK-visible parameters.          | Rejected    | These are FFI artefacts of Move signatures, not semantic inputs. The SDK injects the `0x8` and `0x6` singletons at `toPtb` time; `TxContext` is supplied by the Sui transaction runtime. |
| `Uint8Array` fallback for unknown asset BCS layouts.                                | Rejected (amended 2026-06-12) | Refuted by the prototype: the asset sits mid-struct, so decoding requires the exact schema; a wrong schema misaligns silently. Replaced by required integrator schema + `uidAssetSchema` for uid-only assets + re-serialize byte-compare decode invariant (`EscrowDecodeError`). See §10. |
| Inspect functions as the named category for Pattern A reads.                        | Adopted (2026-06-12) | IO of shape `(client, target, t) => Promise<T>` in `src/views/inspect.ts`; not a `View<T>`, not a fifth primitive. Client by parameter, mirroring time-as-parameter. See §6.2.1. |
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
