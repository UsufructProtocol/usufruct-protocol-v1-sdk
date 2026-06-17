# Usufruct Protocol — SDK design notes & validation log

> This is the SDK's design rationale and the live-testnet validation log accrued
> during its construction. It was the project's original `README.md`; the README
> is now a consumer quickstart, and this document is preserved here as the record
> of *why* the SDK is shaped the way it is and *how* each tier was proven on
> testnet. For the authoritative design see [`SPEC.md`](../SPEC.md); for the four
> primitives, [`ARCHITECTURE.md`](../ARCHITECTURE.md).

## Two tiers (read this first)

The protocol exposes 120+ pure, source-verified view functions, and its view
block takes **zero `&Clock`** (every time-dependent view takes `now_ms: u64`).
That makes a thin wrapper both correct and complete, so the SDK is two tiers:

- **`read` — the default.** A bound `Reader` over the on-chain views via
  `simulateTransaction`. The answer is the deployed bytecode's answer, so
  **drift is zero by construction**; and because the views are `&Clock`-free
  it does *time-travel reads* at any `t` you pass. This is what you want for
  scripting, dashboards, and any one-shot read.

  ```ts
  const r = createReader(client, { packageId, escrowId, typeArguments });
  await r.isIdle();            // boolean   (on-chain)
  await r.handover();          // Handover  (on-chain, collapsed §5.1)
  await r.floorPriceMist(now); // Mist      (time-parameterised)
  const snap = await r.snapshot({ t: now });  // whole table, batched
  ```

- **`sim` — opt-in.** The functional mirror (`EscrowState` / `View` /
  `Action.step` / `sim.curve`) for computation the wrapper cannot do: folding
  actions over hypothetical futures, an off-chain testbed, an agenda over many
  escrows without N round-trips. It *re-derives* the protocol's logic and so
  takes drift risk — every shipped mirror is golden-tested against the
  on-chain view (its oracle, §8). **Tier 2 is complete**: every `step` is a
  deterministic `(state, t)` function (the protocol carries no randomness),
  and the fixed-point curve/settlement math is mirrored bit-exactly in
  `sim.curve`.

  | step | curve consumed | how proven |
  |---|---|---|
  | `apply` (handover) | credit curve → used-credit + bps split | golden vectors + live: settlement == `read.handoverSettlement` == event; state bit-exact |
  | `rent` (install/Descent) | auction curve → descending floor | golden vectors + offline state assembly |
  | `rent` (bid) | price escalation → ascending floor | golden vectors + live `nextFloorPriceMist` |
  | `apply` (tenure/auction expiry), `retire`, `claimAsset`, `borrow`/`return`, governance | none (pure state machine) | live bit-exact vs refetch |

  `sim.curve` is bit-exact-tested against the protocol's own pinned vectors
  (`test/curve-golden.test.ts`: all 5 `CurveShape`s incl. power-law roots,
  exponential ±, logistic; fixed/compound escalation; fee split) and
  cross-checked live (`sim.curve.usedCredit == read.accruedCreditMist`).

- **`actions` — the write path.** `Action.toPtb` builds the PTBs.

The default is `read` precisely to avoid the SDK sin of re-implementing the
contract's read logic in the client and drifting from it. The on-chain views
are the truth; `read` calls them; `sim` is the tested convenience for when
you need local computation. (Full rationale: SPEC §2.1, §6, §12.)

## Prototype status (`prototype/thin-wrapper-default`)

A vertical slice of the SPEC.md design is implemented and validated **live
against testnet v1.4.2** (`npm run e2e` → ALL PASS, 25 offline tests green):

- **Codegen substrate** (`npm run codegen`, `@mysten/codegen` from the local
  Move source; regenerable, committed under `src/codegen/`).
- **Four primitives** (`src/primitives/`): `EscrowState` + `decodeEscrowState`,
  `View<T>`, `Origin/Transition/Terminal` actions, `Source` + `chainSource`.
- **Views**: 14 Pattern B exemplars (predicates, identity, temporal,
  `CurveShape` enum collapse §5.1) + 2 Pattern A `simulateTransaction` reads.
- **Actions**: `integrate`, `rent`, `applyPendingTransitionStates`, `retire`,
  `claimAsset` — `toPtb` complete; `apply.step` and `integrate.step` are real
  and **bit-exact against the live chain** (§8 invariant observed on testnet).
- **Golden gate**: `fixtures/testnet-escrow-1.json` is chain-captured;
  `test/golden.test.ts` replays it offline in CI.

Run the e2e (spends only gas from the signer):

```bash
SUI_PRIVATE_KEY=suiprivkey… npm run e2e   # or: sui keytool export fallback
```

### Scalability findings (prototype assessment)

1. **Codegen coverage — confirmed.** All 43 modules generate; generic
   `Escrow/AssetState/PolicyEnsemble` schemas decode the live object. The
   runtime package id threads cleanly through every wrapper's `package`
   option. Note: generation writes `package_summaries/` inside the Move
   package directory (gitignore it in the protocol repo).
2. **Enum collapse — confirmed.** BCS enums parse as `$kind` discriminated
   unions; the 9-view `credit_shape_*` family collapsed into ~30 lines.
3. **Marginal view cost — confirmed.** ~12 lines/view including docs; the
   remaining ~110 views are mechanical.
4. **Marginal `toPtb` cost — confirmed.** 5–20 lines/action; `&Clock`
   is auto-injected by the generated layer (SPEC §4.3 holds for free).
5. **`step` feasibility — confirmed** for deterministic configs:
   `apply.step` predicted the post-transition on-chain state bit-exactly on
   the first try (tenure expiry → descent → idle chain). Handover settlement
   (curve math) correctly refuses to ship without golden coverage.
6. **Asset-generic `A` — refuted and amended.** The `Uint8Array` fallback of
   SPEC §10 was impossible: the asset sits mid-struct, so decoding *requires*
   the exact schema, and a wrong schema misaligned silently (observed live
   with `DummyAsset { id, uses }`). **SPEC §10 is now amended**: integrator
   schema required, `uidAssetSchema` for uid-only assets, and
   `decodeEscrowState` enforces a serialize∘parse identity invariant
   (`EscrowDecodeError` on mismatch — regression-tested against the fixture).
7. **Kernel stress — none.** No 5th primitive, no methods on state, no
   ambient time. Pattern A reads are now a SPEC-named category — **Inspect
   functions** (§6.2.1): IO `(client, target, t) => Promise<T>` in
   `src/views/inspect.ts`. Time-as-parameter paid off: a ~15s local clock
   skew was harmless for views (same `t` both sides) and only mattered for
   *waiting* on chain boundaries (harness concern, solved by reading the
   `0x6` clock). Open observation: inbox actions (collect) operate on no
   `EscrowState`, so they fit none of the three §4.3 lifecycle variants —
   classification deferred.
8. **Drift detection — exercised and confirmed.** Renaming the
   `TenancySchedule.phase_start` field in a scratch copy of the Move package
   and regenerating produced compile errors *only* in the hand-written files
   that mirror it (`src/views/temporal.ts`, `src/actions/apply.ts` — with
   "Did you mean 'phase_started'?" suggestions); adding a `rent` parameter
   produced exactly one error in `src/actions/rent.ts` ("Source has 3
   element(s) but target requires 4"). Zero errors inside `src/codegen`.
   SPEC §4.5's claim holds precisely.

### Source IO — complete (2026-06-13)

`chainSource(client, { assetSchema?, packageId? })` implements all three IO
shapes over any `ClientWithCoreApi`, within what the transport-agnostic core
API offers:

- **`fetch(id)`** — the state now (`getObject` + decode).
- **`subscribe(id, { pollIntervalMs?, signal? })`** — `AsyncIterable` that
  polls and yields only on object-version change (the core API has no push
  stream; that's gRPC-only). Aborts cleanly. This is "reactive single-writer
  state" (§7) honestly: between emissions, `views` over the last state are
  exact. For push instead of poll, see `grpcSource` below.
- **`query({ byUsufructuary })`** — escrows are *shared* (not listable by
  owner); discovery walks the caller's owned `UsufructCap`s → escrow ids →
  `fetch`, deduped, skipping caps whose escrow was already consumed. Proven
  live: found the rented escrow among 14 live (past 12 stale caps).

`indexerSource(graphqlClient, { packageId, assetSchema? })` is the *non-core*
companion (`@mysten/sui/graphql`): same `Source` contract, but reaches the
discovery the core API can't. It delegates `fetch` / `subscribe` /
`query({ byUsufructuary })` to an internal `chainSource` over the same client,
and adds, via raw GraphQL:

- **`query({ all })` / `query({ byAssetType })`** — `objects(filter:{ type })`
  paginated over the module-qualified `Escrow` prefix → ids → `fetch`. `all`
  yields every shared escrow; `byAssetType` keeps those whose decoded asset
  type matches.
- **`query({ byGovernor })`** — `events(filter:{ type: AssetIntegrated,
  sender })` paginated; the governor signs `integrate`, so `sender == governor`.
  Maps each payload's `escrow_id` → dedupe → `fetch`, skipping consumed escrows.
- **`events({ type, sender?, pageSize? })`** — paginated `AsyncIterable` of
  **typed** events (`TypedEvent { type, module, name, sender, timestamp,
  escrowId, data }`).
- **`escrowTimeline(escrowId, opts?)`** — the star schema's `escrow_id` PK as an
  API: fans out the ~25 escrow-keyed event types (bounded concurrency), filters
  by `escrow_id`, and merges into one time-ordered history. GraphQL can't filter
  a payload field, so the filtering is client-side. Payloads are **BCS-decoded
  from `contents.bcs`** with the codegen structs (bit-exact; cross-checked live
  against the indexer json — note `eventBcs` is a type-tag-wrapped envelope, so
  `contents.bcs` is the field to decode). Proven live (2026-06-14): a 29-event
  timeline for one escrow, ordered, every event keyed to it.

Caveat — **indexer lag**: GraphQL trails the fullnode, so a just-written escrow
may not appear instantly. `query` / `events` reflect the index; the e2e polls
with bounded retry until it shows up. Proven live on testnet (2026-06-13):
`byGovernor` found the freshly-rented escrow, `byAssetType` yielded a typed
escrow, and `events(AssetIntegrated)` carried our `escrow_id`.

`grpcSource(grpcClient, { packageId, assetSchema? })` is the *gRPC-only*
companion (`@mysten/sui/grpc`): same `Source` contract, but `subscribe` is
**server push** instead of poll. `fetch` / `query` delegate to an internal
`chainSource`; only `subscribe` differs. It opens
`subscriptionService.subscribeCheckpoints` — a firehose of every executed
checkpoint (no per-object filter; a `Checkpoint`-rooted `readMask` selects just
each changed object's id + post-tx version) — scans each checkpoint's tx effects
for the escrow, and on a real version change does one `getObject` + decode
(effects carry id+version, not contents). Dedupe by post-tx version; a dropped
stream re-opens with bounded backoff (resumable without gaps). Latency ≈ a
checkpoint instead of a poll interval, and zero traffic while the escrow is idle.
Proven live on testnet (2026-06-13): the push landed **1.5 s** after a mutating
tx was sent — well inside a poll interval.

Since every stream is the same firehose, `subscribeMany(ids)` opens it **once**
and demultiplexes by id — N escrows over one subscription, emitting
`{ escrowId, state }` tagged updates (each escrow's initial state, then per-id
version-deduped deltas; one checkpoint touching several of them emits several
times). The watched set is **live-editable**: `subscribeMany` returns a handle
(an `AsyncIterable` plus `add` / `remove` / `close`) — grow or shrink it in
flight without reopening the firehose. `add(id)` emits the new escrow's initial
state and starts watching; `remove(id)` stops; `close()` (or `opts.signal`) ends
the iteration. Proven live (2026-06-14): opened on one escrow, `add`ed a second
in flight and received its initial, then routed a mutation to its tag.

`memorySource(seed?)` is the fourth `Source` — the **off-chain testbed**, no
network. A `Map`-backed store of `EscrowState` that `Action.step` advances:
because the rest of the SDK doesn't know which `Source` it holds, the *same*
views and actions that run live run here — the whole lifecycle
(integrate → rent → apply → retire → claim) in RAM, instant, gas-free, with the
clock as an explicit `t: Ms` so time can be jumped. `fetch` reads the store;
`subscribe` is event-driven (initial, then on every `set`, deduped, abortable);
`query` answers `all` / `byAssetType` / `byUsufructuary` and throws on
`byGovernor` (not in the escrow state). The testbed surface — `set` / `delete` /
`has` / `size` and `apply` / `applyOrigin` / `applyTerminal` — feeds a step's
successor back in. Proven live (2026-06-14): seeded with a chain-fetched state,
a view through `memorySource` matched the answer over `chainSource` — the
substitution property, no gas.

`memoryInbox(seed?)` is the off-chain mirror of the **second aggregate** — the
earnings / fee mailbox, keyed by inbox object id, holding coin-polymorphic
`MessageGroups`. `post` adds a message, `fetch` partitions by coin type (the
`discoverInboxMessages` mirror), `collect` drains via the same fold the chain
runs. `postSettlement` bridges escrow → inbox (90% of a handover/tenure
settlement → earnings, 10% → protocol fee), closing the 90/10 economy in RAM —
the `collected == posted` conservation the live e2e proves becomes an offline
assertion. Proven live (2026-06-14): seeded with the live inbox groups,
`memoryInbox` reproduced the chain's partition and per-coin totals exactly
(SUI=900, DUMMY_COIN=1636).

`apply.step` settles **both** credit-consuming transitions: the handover
(partial, curve-derived, with a refund) and the **tenure expiry** (full stake,
no refund — `splitFee(principal)`). Both feed `postSettlement`, so the 90/10
economy closes off-chain for every transition that mints messages. The tenure
settlement is triangulated live: `apply.step.tenureSettlement` ==
`read.tenureSettlement()` == the `EarningsMessagePosted` amount (governor=902,
fee=100).

**Multi-tenure** (`committed_tenures > 1`) honours the protocol's split: the
settlement is `splitFee(`*full* stake`)` — the stake is the total across all
committed tenures — while the *price* (the next auction's `last_acq_price`, a
handover's `new_rent_price`) is `stake_per_tenure`. Verified offline (a 2-tenure
expiry: settle 2000 → 1800/200, next price 1000) and live (a 2-tenure rent:
`splitFee(stake) == read.tenureSettlement()`).

The two inboxes differ in custody: the `EarningsInbox` is **per governor**
(owned by the governor, who collects their 90%); the `ProtocolFeeInbox` is **one
global object owned by the protocol deployer**, pooling the 10% from every
escrow. The collect fn has no capability — owning the inbox object *is* the
authority — so fee collection is **owner-signed**. Both paths are now exercised
live: governor-signed earnings collect (`7c`) and owner-signed protocol-fee
collect (`7d`, draining only this run's own `FeeMessage`s by id —
`collected == posted` per coin). The off-chain mirror — many escrows' 90% to
per-governor earnings, every 10% into one fee pool — is `memoryInbox` +
`postSettlement`.

Out of the kernel: *server-side* `escrow_id` event filtering is **not possible**
in `@mysten/sui` v2 (no `MoveEventField` in GraphQL or JSON-RPC) — the client-side
fan-out is the answer, not a TODO. Remaining follow-up: CI.

### Action surface — closed (2026-06-12)

All 13 mutating functions of `escrow.move` plus `cap.move`'s consumers and
the coin-polymorphic collects are implemented and exercised live:

- **Real `step` + live bit-exact parity**: `integrate`, `integrateIntoPortfolio`
  (shares `integrate.step`), `applyPendingTransitionStates` (incl. pending-
  ensemble application), `borrowAsset`/`returnAsset` (composition proven to
  be the identity), `extendRetireCommitment`/`extendEnsembleCommitment`
  (chained anchors), `updateEnsemble` (immediate vs scheduled),
  `updateUsufructuaryRefundAddress`, `burnStaleUsufructCap`,
  `collectMessages` (Transition over the `MessageGroups` inbox aggregate —
  SPEC §4.3 as amended).
- **`toPtb` only (step gated by §8.2 — curve math)**: `rent` (install &
  bid paths), `retire`, `claimAsset`, `apply[handover]` — each exercised
  live; the unimplemented steps throw `NotImplementedStepError`.
- **Plain PTB helpers**: `renounceGovernance`, `burnUsufructCap` (they act
  on the cap object, not on a state aggregate).

**Composability bracket**: `withBorrowedAsset(tx, args, use)` writes the
borrow/return sandwich and hands the user only the middle — the borrowed
asset handle, inside the same PTB. Whatever commands `use` appends run with
the asset in hand (external APIs must take it by reference); the receipt is
never exposed, so the well-formed hot-potato PTB is the only one expressible.
`withBorrowedAssetStep` is the pure mirror: `use` models the foreign API's
effect on the asset value (the SDK guarantees the escrow round-trip; foreign
semantics are the caller's model). Proven live: `dummy_asset::use_asset`
minted a Coupon inside the bracket and the modeled `uses+1` mutation matched
the chain bit-exactly.

**Demand validated live**: bid at the ascending floor (`BidPlaced`), full
64-case parity in the third state, supersede with full refund
(`BidSuperseded`), settlement preview at the boundary, and the handover
itself (`HandoverCompleted` → the superseding bidder occupies). Earnings
conservation holds across the whole life: per coin, collected == sum of all
`EarningsMessagePosted` (handover settlement + both tenure expiries).

### View surface — closed (2026-06-12)

The full read surface of `escrow.move` (~124 public views) plus
`cap.move`/`fees.move` is mirrored by **68 `View<T>` functions + 6 Inspect
functions**, under the broad §5.1 collapse:

| Move family (unrolled) | TS mirror (collapsed) |
|---|---|
| 8 state predicates (`is_*`) | 8 boolean views |
| identity/inboxes/type names | `assetId`, `governanceCapId`, `earningsInboxId`, `feeInboxId`, `assetTypeName`, `coinTypeName` |
| active/pending seat (8 views) | 8 views (caps, addrs, stakes, tenures) |
| cap verification (4 views with arg) | 4 factories `(capId) => View<boolean>` |
| 12 cycle-params accessors | 3 records: `activeCycleParams`, `nextCycleParams`, `pendingCycleParams` |
| ~55 policy views (`*_is_X`, `*_kind`, fields) | 10 discriminated unions (`handover`, `auctionWindow`, `priceEscalation`, `creditShape`, …) |
| temporal + commitments (~18 views) | 18 views (expiries, remaining, anchors, credit flags) |
| settlement/curves (5 views) | 5 Inspect functions (Pattern A — math evaluated by the bytecode) |
| constants (2) | `PROTOCOL_FEE_BPS`, `BPS_DENOMINATOR` |

Verification: a shared data-driven table of **64 parity cases**
(`test/parity-cases.ts`) reconstructs each collapsed value from the unrolled
on-chain views and asserts equality — run live in two states (idle and
occupied; 128 cases, all equal on first run) and replayed offline from
chain-captured fixtures (181 tests). Marginal cost over the full surface:
~7 lines/view — criterion #3's linear extrapolation held.

Demand-state views (`pending*`, `handoverExpiryMs`, …) are validated offline
against a synthetic Demand fixture; reaching Demand live needs a second
bidder and a handover window (deferred with the remaining actions).

**§5.2 proven live (2026-06-12):** `integrate_into_portfolio` put
`EarningsMessage<SUI>` and `EarningsMessage<DUMMY_COIN>` in one shared inbox;
`discoverInboxMessages` partitioned them and `collectMessages` drained both
coins in a single PTB (one fully-qualified `Receiving<…<C>>` vector + one
collect call per coin), 900 mist each — the exact scenario that aborts in
`0x2::transfer::receive_impl` when tickets mix coins.

Chain-observed behaviors worth remembering: `accrued_credit_mist` aborts on a
non-rented escrow; `BasisPoints` has no public constructor (pass pure `u64`,
BCS-identical); fixture parity must capture bytes and view answers at the same
object version.

> The design notes below predate SPEC.md. Where they disagree (e.g. "no
> domain logic in the SDK" vs SPEC's Pattern B TypeScript mirrors with golden
> tests), **SPEC.md governs**.

---

# Usufruct Protocol — SDK Design Notes

> This document captures the architectural philosophy behind the SDK before its
> implementation begins. Read it before writing a single line of TypeScript.

---

## The governing insight

The protocol is the only implementation of the domain. The SDK is not.

This is a deliberate architectural choice with a precise meaning: every question
about protocol state — "can this user bid?", "what is the current floor price?",
"is the asset being retired?" — has exactly one authoritative answer, and that
answer lives in the on-chain Move code, verified by the Move compiler at deploy
time. The SDK does not reimplement those answers. It projects them.

The consequence is that there is no intermediate state with its own semantics.
The chain is the truth. The SDK is a lens.

---

## What this means in practice

### No `switch` on variant strings

Move enums have named variants. When you read a Sui object from the RPC, those
variants arrive as plain strings. The naive SDK pattern is to switch on them:

```typescript
// What you must never do
switch (escrow.fields.lifecycle_state.variant) {
  case "HandoverOpen":   return canBid(...)
  case "HandoverConfirmed": return ...
  default: return false
}
```

This is wrong for three reasons:

1. **Variant names are implementation details**, not the protocol's public API.
   A rename on the Move side breaks all TypeScript silently.

2. **Composed conditions cannot be expressed as a single variant.** `is_rented`
   is true in multiple variants. `is_retiring` is a cross-field condition with no
   variant of its own. A switch gets both wrong.

3. **You are now maintaining a second implementation of the domain in
   TypeScript.** That implementation can diverge. It can have bugs the protocol
   does not have. It must be kept in sync forever.

The protocol exposes boolean predicates precisely to eliminate this pattern:

```typescript
// What the SDK does
const state = {
  canBid:          is_handover_open(escrow) && viewer !== current_tenant_addr(escrow),
  showCountdown:   is_handover_open(escrow) && !is_handover_instant(escrow),
  showRetireAlert: is_retiring(escrow),
  isRented:        is_rented(escrow),
}
```

The frontend reads booleans. It has no opinion about which variants exist.

### No domain logic in the SDK

The SDK has exactly one job: serialize arguments, call the RPC, deserialize the
result. Any time you find yourself writing business logic in TypeScript — "if the
stake is greater than the floor then..." — stop. That logic belongs in the
protocol. If it is not already there, add it as a view function.

The test is simple: if the logic you are writing could have a bug that the Move
type checker would have caught, it is in the wrong place.

### No discrepancy possible

In a system with intermediate state — backend cache, SDK transformation layer,
frontend store — a bug can live in any layer and be internally consistent in all
of them. Debugging means finding which layer has the stale copy.

Here, the chain is the only copy. A bug can only be:

1. A bug in the protocol — caught by the Move compiler or the test suite before
   deploy.
2. A bug in the projection — the SDK asks the wrong question, or the UI renders
   the wrong answer.

The second type is trivial to locate. If `is_rented` returns `true` and the
borrow button is absent, the bug is in the render. There is nowhere else to look.

---

## The three layers

### Layer 1 — Auto-generated bindings

Generated by `@mysten/codegen` from the compiled Move ABI. Covers every public
function, every event type, every PTB call builder. Never written by hand. When
the protocol evolves, regenerate.

### Layer 2 — Semantic SDK

A thin hand-crafted layer that speaks in product terms, not Move terms.

```typescript
// Collects all predicate calls into a single devInspect round-trip
const renderState = await escrow.fetchRenderState(escrowId, viewerAddress)
// → { canBid, canBorrow, showCountdown, isRetiring, currentFloor, ... }

// Price simulation — uses _at_ms variants internally; Clock is irrelevant
const curve = await escrow.simulatePriceCurve(escrowId, {
  from: Date.now(),
  to:   Date.now() + 7 * 24 * 3600 * 1000,
  steps: 48,
})
// → Array<{ timestamp_ms: number, floor_price: bigint }>

// Fee breakdown — exposes compute_handover_settlement arithmetic as plain numbers
const settlement = await escrow.previewHandoverSettlement(escrowId, boundaryMs)
// → { remain_credit: bigint, owner_share: bigint, protocol_fee: bigint }

// Full audit trail from events — star schema on escrow_id, no joins needed
const history = await escrow.fetchTimeline(escrowId)
// → { rentals, bids, borrows, earnings }

// Typed real-time subscriptions
escrow.subscribe(escrowId, {
  onBidPlaced:     (e) => ...,
  onBidSuperseded: (e) => ...,
  onHandover:      (e) => ...,
  onTenureExpired: (e) => ...,
})
```

This layer has no domain logic. It groups predicate calls into ergonomic
round-trips and translates Move types to TypeScript primitives.

### Layer 3 — React hooks

A direct mechanical consequence of Layer 2. The hooks manage React Query
lifecycle; the domain logic stays in Move.

```typescript
function useEscrowState(escrowId: string, viewer: string) {
  return useQuery({
    queryKey: ["escrow", escrowId, viewer],
    queryFn:  () => escrow.fetchRenderState(escrowId, viewer),
    // refetch on new events via subscription
  })
}

function usePriceCurve(escrowId: string, window: { hours: number }) {
  return useQuery({
    queryKey: ["curve", escrowId, window.hours],
    queryFn:  () => escrow.simulatePriceCurve(escrowId, {
      from:  Date.now(),
      to:    Date.now() + window.hours * 3600 * 1000,
      steps: window.hours * 2,
    }),
  })
}
```

A component that uses these hooks has zero knowledge of Move internals:

```tsx
function RentalCard({ escrowId, viewer }: Props) {
  const { data: state } = useEscrowState(escrowId, viewer)
  const { data: curve } = usePriceCurve(escrowId, { hours: 48 })

  return (
    <Card>
      <PriceChart data={curve} />
      {state?.canBid      && <BidButton escrowId={escrowId} floor={state.currentFloor} />}
      {state?.showCountdown && <Countdown expiresAt={state.handoverExpiry} />}
      {state?.isRetiring  && <RetireAlert />}
    </Card>
  )
}
```

---

## Events: the star schema

Every protocol event carries `escrow_id` as its root foreign key. Every event is
self-describing — it contains all the fields needed to interpret it without
joining against any other event.

This means the full history of an escrow is reconstructable from events alone,
with a single query indexed on `escrow_id`. No secondary lookups. No state
reconstruction.

Events are immutable fact rows, not signals. A `HandoverCompleted` event does not
say "something changed, go fetch the new state." It says "a handover happened,
the displaced tenant was X, used credit was Y, protocol fee was Z, owner share
was W." The event is the record.

The SDK builds its `fetchTimeline` entirely from this event stream.

---

## Price simulation

The protocol exposes `_at_ms` variants of every price computation:

- `compute_floor_price_at_ms(escrow, timestamp_ms)`
- `compute_used_credit_at_ms(escrow, timestamp_ms)`

These exist because `devInspect` cannot override the `Clock` object — it always
reads the real network time. Functions that take `&Clock` can only answer "what
is the price right now." Functions that take `u64` can answer "what would the
price be at any point in time."

This transforms `devInspect` into a financial simulation engine. A UI can render
a full price curve for the next N hours with no backend, no off-chain math, and
no possibility of getting a different answer than the contract would compute.

---

## Settlement preview

`RefundState` is a hot-potato type — it has no abilities and cannot be returned
from a view function. Rather than forcing the SDK to reimplement the fee
arithmetic, the protocol exposes:

```
compute_handover_settlement(escrow, boundary_ms) → (remain_credit, owner_share, protocol_fee)
compute_tenure_settlement(escrow, expiry_ms)     → (owner_share, protocol_fee)
```

These return plain `u64` tuples. The SDK can show a complete fee breakdown before
any transaction is submitted. The math is the same math the contract will execute.

---

## What can be built

The examples below exist to demonstrate the SDK to third-party developers. They
are ordered by integration complexity.

### Rental Explorer
A live list of all active escrows with state, current floor price, and tenant.
Demonstrates `fetchRenderState` and event subscriptions updating in real time.
One page. No backend.

### Price Simulator
An interactive chart showing how the floor price of a specific asset evolves over
the next 48–168 hours. Built entirely from `simulatePriceCurve`. The user moves a
slider; the chart updates. Demonstrates that `devInspect` + `_at_ms` is a
complete simulation engine.

### Tenant Dashboard
All active rentals for an address — each with time remaining, current price,
pending bids, and a return action. Demonstrates `useEscrowState` and the
`subscribe` API for real-time updates on bid events.

### Owner Dashboard
Earnings per escrow, historical tenant list, withdraw flow. Built from
`EarningsWithdrawn` events and the `owner_balance` view. Demonstrates the event
timeline and the settlement preview before submitting a claim.

### Bid Monitor
Push notifications when a bid on any watched escrow is superseded. Subscribes to
`BidSuperseded` filtered by `displaced_bidder == myAddress`. The event carries
all necessary information — no fetch needed to compose the notification.

### Embeddable Rental Widget
A self-contained `<RentalWidget escrowId="0x...">` component that any NFT
marketplace can drop into an asset page. The protocol appears where the asset
lives. Demonstrates that the SDK is portable by design — no tight coupling to any
specific frontend.

### Protocol Analytics
Historical revenue, tenant retention rate, price distribution, most-active
assets. Built entirely from the event stream. Demonstrates that the star schema
is sufficient for serious analytics without any on-chain state reads.

---

## The guarantee to third-party developers

When the protocol says the state is X, the state is X.

There is no subgraph that might be one block behind. There is no SDK
transformation that might apply stale logic. There is no intermediate model that
has to be kept in sync with the contract. The SDK calls the protocol, the
protocol answers, the UI renders the answer.

For a developer who has spent time debugging discrepancies between an EVM SDK and
its contract — where the SDK computed a permission correctly given its cached
state, but that state had diverged three steps earlier — this is the argument
that converts.

The absence of intermediate state is not a simplification. It is a correctness
property.
