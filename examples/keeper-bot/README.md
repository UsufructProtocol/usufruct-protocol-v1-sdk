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

### 2. The collision: `nextTransitionAt()` means "overdue NOW", not "next boundary" ⚠️
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

So the keeper reads the **future** boundary from the phase fields, sleeps to it, and
only then is `nextTransitionAt(now)` non-null (confirming it's due) before `apply`:

```ts
const boundary = escrow.handoverExpiresAt   // Date — future boundary, when 'demand'
              ?? escrow.expiresAt;           // Date — the tenure end, when 'occupied'
// sleep to `boundary` on the chain clock, then apply (nextTransitionAt(now) is now Some).
```

**Not a gap — a naming/doc trap.** Registered as an SDK improvement (below).

### 3. read projects / write applies, on the chain clock
The keeper reads with the now_ms-parameterized views (the handle resolves at the
chain clock via `resolveWhen`, not `Date.now()` — so no local-skew bug, the gotcha
we hit earlier in `chainNowMs`). It decides from the projection, then `apply`
materializes it.

### 4. The keeper is ~30 lines of composition
`watch` (event) + a phase-field boundary + `waitForChainTime` + `applyPendingTransitionStates`.
No core changes. A `keeper(escrows)` loop helper would be reasonable sugar.

## Registered SDK improvement (from this probe)

1. **Done here — disambiguate the JSDoc.** `escrow.nextTransitionAt()` (and the
   `Reader.nextTransitionMs`) said "*when the next lazy transition is **due***". The
   doc now states it returns the **overdue-and-unapplied** transition's timestamp (or
   `null` when none is due yet) — a keeper's "is there work *now*?" check, twin of
   `transition_is_ready` — **not** a future-boundary oracle. (Tightened in
   `packages/sdk/src/highlevel/escrow.ts` + `read/reader.ts`.)
2. **Proposed (API, not yet built).** Add `escrow.nextBoundaryAt(): Promise<Date | null>`
   that returns the next *future* boundary regardless of crossing — i.e.
   `handoverExpiresAt ?? expiresAt ?? <auction descent end>` — so a keeper has one
   call to schedule on, instead of composing phase fields by hand. Pure composition
   over existing reads; deferred as a separate ergonomics PR.

## Run it

From the monorepo root (build the SDK first: `npm install && npm run build`):

```bash
npx tsx examples/keeper-bot/index.ts
```

Needs a funded testnet signer (operator + keeper): `SUI_PRIVATE_KEY` env or the
`usufruct-sdk-testnet` CLI alias. Runs ~1 minute (two short on-chain waits).
Testnet only; the public fullnode is flaky (occasional 5xx — just re-run).
