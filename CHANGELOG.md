# Changelog

All notable changes to the Usufruct Protocol SDK monorepo
(`@usufruct-protocol/sdk` + `@usufruct-protocol/sim`) are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this
project adheres to [Semantic Versioning](https://semver.org/). Both packages are
versioned together while pre-1.0.

## [1.0.0-rc.1] — 2026-06-24

The handle API is reshaped into one fractal, navigable form: every object is its
**identity** (the object's name) plus five verbs — **`nav · read · inspect · react ·
write`** — repeated identically on the root `u` and on every handle. This is the v1.0
shape (release candidate), the first published version.

### Added

- **`to` on the minting writes — direct the created object's destination.** `rent`,
  `integrate`, and `claim` mint owned objects and transfer them to the sender by
  default; pass `to` to redirect them atomically in the *same* transaction (rent on
  behalf of a buyer, list with the cap going to a cold governor and earnings to a
  treasury, claim straight to a recipient — no second transfer). `rent({ …, to })`
  and `claim(escrow, { to })` take an address; `integrate({ …, to })` takes a
  structured `{ governanceCap?, earningsInbox? }` since it mints two. Default is
  unchanged (the sender). Deep PTB composition (routing a minted value into another
  Move call) stays in the bare actions (`u.primitives` / `…/actions`). Live-validated.

### Changed (breaking)

- **`UsufructCapRole` → `UsufructCapStatus`; `state.role` → `state.status`; the
  `'unknown'` member is gone.** A held cap is always `active`, `pending`, or `stale`
  — those three are exhaustive, so `state()` now throws on a cap that is neither a
  seat nor stale (a wrong cap/escrow pairing) instead of returning a phantom status.
  "Status", not "role": authority is object possession, not a permission read (the
  same reason `escrow.read.role()` was removed).
- **`governanceCap.write.renounce()` → `renounceGovernance()`.** An irreversible
  burn deserves an unambiguous name, matching the Move entry `cap::renounce_governance`.

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
- **No `escrow.read.role()`.** The composite that bundled `canRent`/`canBorrow`/
  `canGovern`/`holdsEarnings` is removed — authority in Usufruct is plain Sui object
  ownership, not a permission read, so a single "role" overstated it. Ask the canonical
  views instead: `escrow.read.isRetired()` (rentable), `cap.read.isActive()` (hold the
  seat), `u.inspect.governedBy(addr)` / `rentedBy(addr)` (govern/rent), or the
  `ownedIds` primitive those compose over. `EscrowSnapshot` drops its `role` field
  (now `{ at, state }`); `EscrowRole` and `resolveRole` are gone (`ownedIds` stays).
- **`graphql` defaults from `network`** (testnet/mainnet/devnet) — `inspect.*` works
  out of the box; pass `graphql: false` to disable, or a URL/client to override.
- **One cross-state cycle-params view.** The reader's `activeCycleParams` (Renting
  only) + `nextCycleParams` (Waiting only) collapse into a single `cycleParams`,
  matching the protocol's unified `cycle_*` views (the resolved cycle of the active
  ensemble is cross-state — non-null in every state but `retired`). The `sim` mirror
  view and the golden fixtures follow. Re-codegen'd against the new testnet deployment.

### Fixed

- The live `escrow.read.cycle()` and `escrow.read.descentCurve()` read the resolved
  cycle from the cross-state `cycleParams` view, so both work in idle/descent (the old
  `activeCycleParams` was `None` there — a latent null that surfaced as a broken
  `descentCurve`). Drift-zero against the view.

## [0.1.0] — never published

_Not released on its own — its contents ship as part of `1.0.0-rc.1` (the first
published version). Kept here as the record of the core surface 1.0 builds on._

The SDK is the high-level, object-centric TypeScript API over the Usufruct protocol,
split along a **drift-zero seam**.

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
