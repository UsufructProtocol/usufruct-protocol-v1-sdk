# Probe B — keeper / settler bot

**Primitives under test:** `Source.subscribe` (the `escrow.watch` event stream) +
the `Reader` + the **lazy-state transition model**.
**Question:** how do *events* and *time* interact — can you build a keeper, and
what does it reveal?

## The model (two clarifications that shape everything)

1. **Transitions are lazy.** A tenure expiring or a handover window closing is not
   an on-chain event by itself — the chain only advances when **some write touches
   the escrow**, and **every write (`rent`, `bid`, `borrow`, `collect`, …) calls
   `apply` internally first.**
2. So under activity the system is **self-maintaining** — the next organic tx
   flushes any due transition. `applyPendingTransitionStates` is the *only* write
   whose sole job is to flush. **A keeper is never required; it buys timeliness in
   *quiet* windows** (a boundary passes and nobody is interacting).

That makes the keeper a clean probe: to observe it doing anything, you must isolate
a quiet window where its `apply` is the **only** write that advances state.

## What it does

One keeper over one escrow's lifecycle, acting in two quiet windows:

- Bob rents → `occupied`; Carol bids the occupied escrow → `demand` (organic writes;
  each self-applies).
- **③ quiet window #1 — handover:** the keeper sleeps until the handover boundary
  (chain clock), then `apply` → Carol active (`occupied`), Bob displaced.
- **④ quiet window #2 — tenure expiry:** the keeper sleeps until the tenure boundary,
  then `apply` → seat released (`idle`).

Live result: **ALL PASS** — both transitions keeper-driven, and across each
wall-clock wait the `watch` stream fired **0 times**. It fired 6× total: once per
organic write and once per keeper `apply` — never on a bare clock tick.

## Findings

### 1. `subscribe` ≠ time (the headline, proven)
`escrow.watch` fires on a **version change** — a write, including the `apply` that
flushes a queued lazy event. Wall-clock crossing a boundary produces **no event**.
So a keeper can't *wait for an event* to learn a boundary passed; it must **schedule
on the chain clock**, `apply`, and that apply is what emits the queued event. The
demo asserts this directly: 0 `watch` fires across each boundary wait.

### 2. The collision (now resolved): `nextTransitionAt()` means "overdue NOW", not "next boundary"
The obvious keeper design — "ask the SDK for the next boundary and sleep to it" —
**did not work**. `escrow.nextTransitionAt()` returned **`null` in both `occupied`
and `demand`**, even mid-tenure with a known expiry.

Reading the contract explains it precisely. `next_transition_ms` →
`asset_state::compute_next_pending(state, now)`, which returns `Some(boundary)`
**only if the boundary is already _crossed_** (`proj_*_is_firable` = `now.proj_is_crossed()`):

```move
Idle | Retired => none()                              // never a scheduled transition
Occupied { .. } => firable ? some(boundary) : none()  // firable = now has passed the tenure end
Demand   { .. } => firable ? some(handover.expiry) : none()
```

So `next_transition_ms` is the keeper's **"is a lazy transition OVERDUE and unapplied
right now?"** check — the twin of `transition_is_ready(now): bool` — **not** "when is
the next future boundary." Calling it *before* the boundary (mid-tenure) correctly
says "nothing pending → null". This is correct, intentional contract behavior; the
trap was the SDK JSDoc wording *"when the next lazy transition is **due**"* — "due"
means *overdue*, not *scheduled*.

**Resolution (shipped).** The keeper needs the *future* boundary, so the protocol
now exposes one — `next_boundary_ms` (+ `descent_expiry_ms`), the ungated twin of
`next_transition_ms` — and the SDK surfaces it as `escrow.nextBoundaryAt()`. The
keeper reads that single oracle, sleeps to it, and applies:

```ts
const at = await escrow.nextBoundaryAt();   // future boundary, ALL phases, drift-zero
// sleep to `at` on the chain clock, then apply.
```

This also closes a latent **descent blind spot**: the old hand-composition
(`handoverExpiresAt ?? expiresAt`) was `null` in the auction phase; `nextBoundaryAt()`
covers it, and keeps the boundary math on-chain. **Not a gap — a missing view, now
added** (see SDK improvement below).

### 3. read projects / write applies, on the chain clock
The keeper reads with the now_ms-parameterized views (the handle resolves at the
chain clock via `resolveWhen`, not `Date.now()` — so no local-skew bug, the gotcha
we hit earlier in `chainNowMs`). It decides from the projection, then `apply`
materializes it.

### 4. The keeper is ~30 lines of composition
`watch` (event) + `nextBoundaryAt()` + `waitForChainTime` + `applyPendingTransitionStates`.
No core logic changes. A `keeper(escrows)` loop helper would be reasonable sugar.

## SDK improvements from this probe (shipped)

1. **Disambiguated the JSDoc.** `escrow.nextTransitionAt()` / `Reader.nextTransitionMs`
   now say they return the **overdue-and-unapplied** transition's timestamp (or `null`
   when none is due) — a keeper's "is there work *now*?" check, twin of
   `transition_is_ready` — **not** a future-boundary oracle.
2. **Added the future-boundary view.** The protocol gained `next_boundary_ms`
   (+ `descent_expiry_ms`), the ungated twin of `next_transition_ms`; the SDK surfaces
   them as `escrow.nextBoundaryAt()` / `escrow.descentExpiresAt()`. One drift-zero call
   for the next boundary across all phases — the keeper schedules on it directly. The
   auction-descent boundary computation stays on-chain (no off-chain re-derivation).
   Deployed to testnet and live-validated here.

## Run it

From the monorepo root (build the SDK first: `npm install && npm run build`):

```bash
npx tsx examples/keeper-bot/index.ts
```

Needs a funded testnet signer (operator + keeper): `SUI_PRIVATE_KEY` env or the
`usufruct-sdk-testnet` CLI alias. Runs ~1 minute (two short on-chain waits).
Testnet only; the public fullnode is flaky (occasional 5xx — just re-run).
