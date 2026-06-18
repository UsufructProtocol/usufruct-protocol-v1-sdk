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

The protocol is live on Sui testnet at **v1.4.3**:

- Package: `0xf5f039b85aad208f77ed5eec05df51dc889154a0491709c5a9cb4ecb17a62567`
- Source-verified on-chain.

**Do not assume SDK code works by reading it.** Build against testnet and observe the actual chain response — the chain is the arbiter. A PTB that looks correct may abort for a non-obvious reason (type argument mismatch, lazy state not applied, coin-polymorphic inbox partition, etc.). The profiling harness in the protocol repo (`profiling/`) and the audit harness (`audit/`) are reference implementations for how to build and submit PTBs correctly.

If in doubt about a behavior, check the live object or submit a test PTB rather than reasoning from the code alone.

## Design reference

**`SPEC.md` in this directory is the authoritative design document.** Read it before writing any TypeScript. Any proposed module, type, or function must fit one of the four primitives defined there, or it must justify amending the spec.

The four primitives, split by the **drift-zero seam** — the core never decodes an
escrow (it reads on-chain via the `Reader`), so the *decoded* model and its
re-derivations live in the **mirror** (`@usufruct-protocol/sim`):

| Primitive | Role | Where |
|---|---|---|
| `Source` | Single point of IO: `fetch`/`subscribe`/`query`, yielding a raw **`EscrowSnapshot`** (ids + type tag + BCS bytes). | core (`@usufruct-protocol/sdk`) |
| `Action.toPtb` | The on-chain interpretation: append the Move call to a PTB. | core |
| `Reader` | Drift-zero reads: on-chain views via `simulateTransaction` (not in the original four; the core's read surface). | core |
| `EscrowState<A, C>` | BCS-**decoded** snapshot. Immutable, no network reference. `decodeEscrowState` turns a `Source` `EscrowSnapshot` into it. | mirror (`@usufruct-protocol/sim`) |
| `View<T>` | Pure function `(state, t: Ms) => T`. One per public view in `escrow.move`. | mirror |
| `Action.step` | The off-chain pure interpretation `(state, t) => …`. | mirror |

The dependency arrow is **sim → sdk** (the mirror imports the core, never the
reverse). The kernel is unchanged in spirit; it is split by where drift can occur.

## Project structure

```
packages/sdk/src/   # the drift-zero CORE
  primitives/       # EscrowSnapshot + Source, Action.toPtb (no decoded EscrowState)
  read/             # the Reader — on-chain views via simulateTransaction
  codegen/          # auto-generated types + BCS schemas + bare PTB calls
  actions/          # hand-written Action.toPtb constructors
  highlevel/        # Layer 2 handles (usufruct, escrow, cap, …)
  config/           # DSL config builder
packages/sim/src/   # the MIRROR (opt-in, sim → sdk)
  primitives/       # EscrowState, decodeEscrowState, View, the lifecycle step-types
  views/            # hand-written View<T> functions
  sim/actions/      # Action.step constructors (paired with the core's toPtb)
fixtures/           # cross-runtime golden test fixtures (Move → TS)
test/               # TypeScript tests consuming fixtures
```

## Key development rules

- **`SPEC.md` governs.** Capabilities emerge from composing the four primitives; no new core primitives.
- **Read strategy:** the **on-chain view** is the default — the `Reader` runs the deployed views via `simulateTransaction`, so reads are **drift-zero** by construction (the core never decodes an `EscrowState`). The TypeScript **mirror** (`@usufruct-protocol/sim`: `EscrowState` + `View`/`Action.step`) is **opt-in** for local computation (simulation, what-if, off-chain agendas); it re-derives logic and so carries drift risk, gated by golden coverage (`SPEC.md §8.2`).
- **`EscrowState` is a mirror type, not core.** A `Source` yields a raw `EscrowSnapshot`; `decodeEscrowState` (in `sim`) turns it into the decoded `EscrowState`. The core reasons via the `Reader`, never by decode-and-derive. (Still: no methods on `EscrowState` — state is data, not object.)
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
