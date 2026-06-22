# Usufruct Protocol — TypeScript SDK (monorepo)

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)

The official TypeScript SDK for the **Usufruct Protocol** — an on-chain rental
market primitive for any Sui asset, priced in any payment coin. Always-liquid,
with handover protection, lazy state transitions, and composable with any Sui
protocol.

- Protocol: https://github.com/UsufructProtocol/usufruct-protocol-v1
- Live on Sui **testnet** (`v1.4.3`), source-verified on-chain.

## Two packages, one drift-zero seam

The SDK is split along a single seam — **the core cannot drift; the mirror can:**

| Package | Role |
|---|---|
| **[`@usufruct-protocol/sdk`](./packages/sdk)** | The **drift-zero core**. Decode + `Source` IO + the on-chain `Reader` (evaluates the deployed Move views via `simulateTransaction`) + `Action.toPtb`. The high-level Layer-2 API (`usufruct()`, `escrow.*`, the capability handles) lives here and reads everything through the `Reader`, so it **cannot drift from the contract**. Depends only on `@mysten/sui`. **Start here.** |
| **[`@usufruct-protocol/sim`](./packages/sim)** | The **opt-in mirror**. Re-derives the protocol off-chain — the compute `View<T>` functions, `Action.step`, the fixed-point curve, `MemorySource`/`memoryInbox` — for forward simulation, what-if analysis, and an offline testbed. Takes drift risk, so it is **golden-tested against the core's `Reader`**. One-way dependency: `sim → sdk`. |

**Why a drift-zero core is possible:** `usufruct` exposes its **entire runtime** as
~124 pure, total, `&Clock`-free views (every time-dependent view takes `now_ms`).
That exhaustive read surface lets the core answer every effective value on-chain, at
any `t`, with drift zero — so re-deriving the contract in TypeScript (the mirror) is
opt-in, not the default. See [`ARCHITECTURE.md`](./ARCHITECTURE.md) §"Drift-zero
core" and [`SPEC.md`](./SPEC.md) §2.1/§12.

## Quickstart

```bash
npm i @usufruct-protocol/sdk @mysten/sui
```

```ts
import { usufruct } from '@usufruct-protocol/sdk';

const u = usufruct({ network: 'testnet' }); // picks the network's RPC + GraphQL endpoints

const escrow = await u.nav.escrow('0x…');           // resolve the handle (identity only)
const state  = await escrow.read.assetState();      // live: a discriminated union
state.kind;                                          // 'idle' | 'descent' | 'occupied' | 'demand' | 'retired'
await escrow.read.floorPrice();                      // a Price, rendered in the escrow's own coin
await escrow.write.rent({ tenures: 1 }).send();      // pay the floor → a UsufructCap
```

Every object is its **identity** (the object's name) plus five verbs —
**`nav · read · inspect · react · write`** — and the shape is **fractal**: the same
five sit on the root `u` and on every handle (escrow / cap / governanceCap / inbox).
See [the fractal, navigable API](./journeys/read-write-inspect-react.md). Full
quickstart in the [core package README](./packages/sdk/README.md).

## Design & reference

- [`SPEC.md`](./SPEC.md) — authoritative design: the drift-zero split. The **core**
  (`@usufruct-protocol/sdk`) is three primitives — `Source` (raw `EscrowSnapshot`),
  the `Reader` (on-chain views), and `Action.toPtb`; it never decodes an escrow. The
  decoded `EscrowState` (`decodeEscrowState`), `View`, and `Action.step` are the
  **mirror** (`@usufruct-protocol/sim`).
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — the primitives, how they compose, and the
  drift-zero seam.
- [`journeys/`](./journeys) — the object model (authority = possession), the
  [fractal, navigable API](./journeys/read-write-inspect-react.md)
  (`nav · read · inspect · react · write`),
  [write paths](./journeys/write-paths.md) (`Plan` · `send` vs `build`), and
  [borrow composition](./journeys/borrow-composition.md) (recipes around the rented asset).
- [`scripts/`](./scripts) — runnable, testnet-validated examples of every flow.

## Development

```bash
npm install        # workspaces: links @usufruct-protocol/{sdk,sim}
npm run build      # tsc -b packages/sdk packages/sim
npm run lint
npm test           # vitest (resolves the packages to source — no build needed)
```

## License

Apache-2.0
