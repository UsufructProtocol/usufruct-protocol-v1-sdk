# CLAUDE.md — Usufruct Protocol SDK

## What this project is

This is the official TypeScript SDK for the **Usufruct Protocol** — an on-chain rental market primitive for any Sui asset, any payment coin. Always-liquid with handover protection, lazy state transitions, and composable with any Sui protocol.

- Protocol repo: https://github.com/UsufructProtocol/usufruct-protocol-v1
- npm package: `@usufruct-protocol/sdk`
- License: Apache-2.0

## Protocol overview

A governor wraps any Sui object (`key + store`) into an escrow and configures the market. Usufructuaries pay to acquire the right of use, receiving a `UsufructCap`. The asset is always liquid — a challenger can bid at any time; the current usufructuary is guaranteed a handover window before displacement. State transitions execute lazily on the next transaction that touches the escrow — no keeper, no cron job.

Key objects:
- `Escrow<Asset, CoinType>` — the shared object; one per listed asset
- `GovernanceCap` — governance capability for the governor
- `UsufructCap` — usage capability for the current usufructuary
- `EarningsInbox` — governor's income mailbox (separate from governance)
- `ProtocolFeeInbox` — protocol fee accumulator

Economics: 90% of consumed credit → governor's `EarningsInbox`; 10% → protocol fee.

## Testnet deployment — use it, always

The protocol is live on Sui testnet at **v1.4.2**:

- Package: `0x415c4372bb9db5affe2ab2bf6d72a6a667ed3178a61d6201e9ff26dc76380e5d`
- Source-verified on-chain.

**Do not assume SDK code works by reading it.** Build against testnet and observe the actual chain response — the chain is the arbiter. A PTB that looks correct may abort for a non-obvious reason (type argument mismatch, lazy state not applied, coin-polymorphic inbox partition, etc.). The profiling harness in the protocol repo (`profiling/`) and the audit harness (`audit/`) are reference implementations for how to build and submit PTBs correctly.

If in doubt about a behavior, check the live object or submit a test PTB rather than reasoning from the code alone.

## Design reference

**`SPEC.md` in this directory is the authoritative design document.** Read it before writing any TypeScript. Any proposed module, type, or function must fit one of the four primitives defined there, or it must justify amending the spec.

Summary of the four primitives:

| Primitive | Role |
|---|---|
| `EscrowState<A, C>` | BCS-decoded snapshot of an on-chain escrow. Immutable, no network reference. |
| `View<T>` | Pure function `(state, t: Ms) => T`. One per public view in `escrow.move`. |
| `Action<R>` | Value with two interpretations: `step` (off-chain pure) and `toPtb` (on-chain PTB). |
| `Source` | Single point of IO: `fetch`, `subscribe`, `query`. |

## Project structure

```
src/
  primitives/     # EscrowState, View, Action, Source
  codegen/        # auto-generated types + BCS schemas + bare PTB calls
  views/          # hand-written View<T> functions
  actions/        # hand-written Action constructors
  config/         # DSL config builder
fixtures/         # cross-runtime golden test fixtures (Move → TS)
test/             # TypeScript tests consuming fixtures
```

## Key development rules

- **`SPEC.md` governs.** Capabilities emerge from composing the four primitives; no new core primitives.
- **Read strategy:** Pattern B (fetch + TypeScript mirror) is the default. Pattern A (`devInspect`) is used only for curve/settlement math where bit-exact replication carries drift risk.
- **No methods on `EscrowState`.** State is data, not object.
- **Time is always an explicit parameter** (`t: Ms`). No ambient `now()`.
- **`@mysten/sui` v2 — choose the right client per use case.** Do not assume one client fits all operations. Evaluate before picking:
  - `SuiGrpcClient` (`@mysten/sui/grpc`) — recommended default; best for object fetches and event streaming (`ChainSource`).
  - `SuiJsonRpcClient` (`@mysten/sui/jsonRpc`) — retrocompatible; use when gRPC is unavailable or for tooling that expects JSON-RPC.
  - `SuiGraphQLClient` (`@mysten/sui/graphql`) — best for flexible queries, field selection, and cursor-paginated history (`IndexerSource`). Not suited for streaming or high-frequency fetches.
  The old `SuiClient` from `@mysten/sui/client` was removed in v2. `Source` implementations should accept `ClientWithCoreApi` to stay transport-agnostic where possible.
- **Coin-polymorphic inboxes require partitioning.** The collect `Action` must partition inbox messages by coin type and emit one PTB per `C` — a mismatched `Receiving<T>` aborts inside `0x2::transfer::receive_impl` with an opaque error. See `SPEC.md §5.2`.

## Testnet wallet

Before running any test against testnet, you need a funded address. Ask the user
for a testnet address with SUI balance before submitting any transaction. Do not
generate or assume an address — the user must supply it explicitly.

If the user does not have one, they can get testnet SUI from the faucet:
```
sui client faucet --address <address>
```
or via https://faucet.sui.io (testnet).

## Commands

```bash
npm run build    # compile TypeScript → dist/
npm run dev      # watch mode
npm run lint     # ESLint
npm run format   # Prettier
```
