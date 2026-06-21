# Changelog

All notable changes to the Usufruct Protocol SDK monorepo
(`@usufruct-protocol/sdk` + `@usufruct-protocol/sim`) are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this
project adheres to [Semantic Versioning](https://semver.org/). Both packages are
versioned together while pre-1.0.

## [1.0.0-rc.1] — Unreleased

The handle API is reshaped into one fractal, navigable form: every object is its
**identity** (the object's name) plus five verbs — **`nav · read · inspect · react ·
write`** — repeated identically on the root `u` and on every handle. This is the v1.0
shape (release candidate).

### Changed (breaking)

- **Handles are identity + verbs only.** The flat surface is gone:
  `escrow.status`/`floorPrice`/`rent()`/`activeCap`/… → `escrow.read.assetState()`
  (a discriminated union), `escrow.read.floorPrice()`, `escrow.write.rent()`,
  `escrow.nav.activeCap()`. Same for `UsufructCap`, `GovernanceCap`, the inboxes, and
  the root (`u.escrow(id)` → `u.nav.escrow(id)`; `u.escrowsGovernedBy` →
  `u.inspect.governedBy`; `u.integrate` → `u.write.integrate`).
- **No fetch-time photo.** `Escrow` construction is lazy — it resolves only identity
  (type args + coin); the verbs read the deployed views live, so nothing the handle
  exposes can go stale. The eager snapshot/role batch (and its `createEscrowMany`
  pre-resolution) is removed.
- **`nav`** is the new verb for graph edges (an escrow's seats/counterparts, a cap's
  escrow, the root's "open this id"); collections stay under `inspect`.
- **`read`** auto-renders the protocol's whole view surface (mist→`Price`,
  ms→`Date`/duration) — every on-chain view has a home on the object — plus composites
  (`assetState`, `market`, `cycle`, `role`, live `creditCurve`/`descentCurve`).
- **No `escrow.reader`** on the handle; the kernel reader stays reachable via
  `u.primitives.reader(target)`.
- **`react.waitFor`** takes an async predicate over the handle and resolves to the
  handle: `escrow.react.waitFor(async e => (await e.read.assetState()).kind === 'demand')`.

### Fixed

- The live `escrow.read.descentCurve()` reads the descent's resolved cycle from
  `nextCycleParams` (the Waiting-state projection `proj_waiting_resolved_*`), not
  `activeCycleParams` (the Renting-only projection `proj_active_cycle_params`, which
  is `None` while waiting). The cycle is always resolved — the two views just project
  different halves of the state machine. Now drift-zero against the view.

## [0.1.0] — Unreleased

First public release. The SDK is the high-level, object-centric TypeScript API over
the Usufruct protocol (live on Sui testnet v1.4.3), split along a **drift-zero seam**.

### Added

- **`@usufruct-protocol/sdk` — drift-zero core.** Decode + `Source` IO + the
  on-chain `Reader` (Move views via `simulateTransaction`) + `Action.toPtb`. The
  Layer-2 API lives here and reads through the `Reader`, so it cannot drift from the
  contract (SPEC §7.2, §12).
  - The four object-centric verbs — **read · write · inspect · react**:
    `usufruct()`, the capability handles (`Escrow`/`UsufructCap`/`GovernanceCap`/
    `EarningsInbox`/`ProtocolFeeInbox`), discovery (`escrowsGovernedBy`…),
    `escrow.history()`, and gRPC push (`escrow.watch`/`waitFor`/`on`/`next`).
  - **SDK-level retry** for transient public-fullnode faults — `retryingClient` /
    `retryingReader` / `withRetry`, on by default; retries idempotent reads on
    HTTP-status *and* network transients (`fetch failed`/connect-timeout), never
    execution.
  - **Portfolio watch** over one gRPC firehose — `u.watchMany` and
    `governanceCap.watch` (decode-free `escrowVersionChangesMany`).
  - **Object-centric reads** — `usufructCap.state()`/`isActive()`/`isPending()`/
    `isStale()` (role-gated seat economics) and `governanceCap.governs(escrow)`.
  - **Drift-zero abort mapping** — the full runtime-abort registry is generated from
    the Move source (`scripts/gen-aborts.ts` → `aborts.generated.ts`), and `mapAbort`
    resolves any on-chain abort to a `MoveAbortError` carrying its verbatim source
    name (`.abort`/`.module`/`.code`), with curated overlay subclasses. A live harness
    (`npm run aborts`) provokes every reachable abort on testnet.
- **`@usufruct-protocol/sim` — opt-in mirror.** The off-chain re-derivation tier
  (`View<T>`, `Action.step`, the fixed-point curve, `MemorySource`/`memoryInbox`)
  for simulation, what-if analysis, and an offline testbed; golden-tested against
  the core's `Reader` (one-way dependency `sim → sdk`).
- Publish-readiness: per-package `files`/`exports`/`prepack`/`publishConfig` +
  `README`/`LICENSE`; CI (build · lint · test on Node 20/22).

### Changed

- **Repository → monorepo** with a drift-zero seam: the off-chain mirror (which can
  drift) was split out of the core (which cannot) into `@usufruct-protocol/sim`.
- `escrow.history()` walks the escrow's own transactions (`affectedObject`) instead
  of a 25-way per-event-type fan-out — far fewer requests, no public-endpoint choke.
- Seat reads (stake / time-remaining / accrued credit) moved from the `Escrow`
  handle onto the `UsufructCap` (`cap.state()`) — one home per view, object-centric.

### Fixed

- `retryingClient` proxy preserves `this` for proxied client methods (gRPC private
  fields) — execution is bound but never retried.
- **Compound price escalation** now builds a valid PTB: the `bps` argument is
  constructed via `ensemble::basis_points` (exposed in protocol v1.4.3) instead of a
  raw `tx.pure.u64`, which Sui rejected for a struct type (`InvalidUsageOfPureArg`).
  `escalation: { compound: … }` was previously unbuildable.
