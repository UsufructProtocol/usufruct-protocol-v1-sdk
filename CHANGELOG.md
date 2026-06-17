# Changelog

All notable changes to the Usufruct Protocol SDK monorepo
(`@usufruct-protocol/sdk` + `@usufruct-protocol/sim`) are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this
project adheres to [Semantic Versioning](https://semver.org/). Both packages are
versioned together while pre-1.0.

## [0.1.0] — Unreleased

First public release. The SDK is the high-level, object-centric TypeScript API over
the Usufruct protocol (live on Sui testnet v1.4.2), split along a **drift-zero seam**.

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
