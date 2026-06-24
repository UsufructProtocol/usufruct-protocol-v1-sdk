# @usufruct-protocol/sdk

[![npm](https://img.shields.io/npm/v/@usufruct-protocol/sdk/next?color=cb3837&logo=npm&label=npm%20%40next)](https://www.npmjs.com/package/@usufruct-protocol/sdk)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)
[![Built for Sui](https://img.shields.io/badge/Built_for-Sui-6fbcf0)](https://sui.io)

The official TypeScript SDK for the **Usufruct Protocol** — an on-chain rental
market primitive for **any Sui asset, priced in any payment coin**. Always-liquid,
with handover protection, lazy state transitions, and composable with any Sui protocol.

## Install

```bash
npm i @usufruct-protocol/sdk@next @mysten/sui
```

> **Release candidate** — published under the `next` dist-tag, so the `@next` is
> required (a bare `npm i` won't resolve a pre-release). `pnpm add` / `yarn add` /
> `bun add` work the same with `@next`.

## 60-second example

```ts
import { usufruct } from '@usufruct-protocol/sdk';

const u = usufruct({ network: 'testnet', signer });           // signer = your keypair
const escrow = await u.nav.escrow('0x…');
const cap = await escrow.write.rent({ tenures: 1 }).send();   // → a UsufructCap
await cap.write.borrow((asset, tx) => { /* use the asset, mid-PTB */ }).send();
```

→ **[QUICKSTART](./QUICKSTART.md)** (install → a full rental lifecycle) ·
**[API reference](./API.md)** · **For AI agents: [`llms-full.txt`](./llms-full.txt)**

## What you can build

- **Rent the *use* of any asset** — NFTs, game items, capabilities, RWAs: any
  `key + store` object, priced in any `Coin<C>`.
- **A tradable right of use** — the `UsufructCap` is a bearer object: sell it, lend
  it, route it. Possession is the role.
- **Compose with all of Sui** — `borrow` hands you the asset mid-PTB to feed into any
  Move call (staking, AMMs, games), with a guaranteed return.

## The shape, in one breath

Every object is its **identity** plus five verbs — **`nav · read · inspect · react ·
write`** — identical on the root `u` and on every handle (`Escrow` / `UsufructCap` /
`GovernanceCap` / inboxes). Reads are **drift-zero** (the deployed Move views, live).
Writes are **`Plan`s**: `.send()` runs build + sign + decode; `.build(tx, sender)` lets
you drive the PTB. See [`concepts/api-design.md`](./concepts/api-design.md).

## Docs

- [`QUICKSTART.md`](./QUICKSTART.md) — install → a full lifecycle, step by step.
- [`API.md`](./API.md) — the complete public surface (every handle, verb, signature).
- [`concepts/`](./concepts) — api-design · write-model · borrow · primitives · cookbook · faq.
- [`SPEC.md`](./SPEC.md) · [`ARCHITECTURE.md`](./ARCHITECTURE.md) — the drift-zero design.
- [`scripts/`](./scripts) — runnable, testnet-validated examples of every flow.
- **AI agents:** [`llms.txt`](./llms.txt) (the curated index) · [`llms-full.txt`](./llms-full.txt)
  (the self-contained payload — load it and an agent writes working scripts without
  learning the API by hand).

## Two packages, one drift-zero seam

| Package | Role |
|---|---|
| **[`@usufruct-protocol/sdk`](./packages/sdk)** | The **drift-zero core** — decode + `Source` IO + the on-chain `Reader` + `Action.toPtb`. The high-level API lives here and reads through the `Reader`, so it **cannot drift** from the contract. Depends only on `@mysten/sui`. **Start here.** |
| **[`@usufruct-protocol/sim`](./packages/sim)** | The **opt-in mirror** — re-derives the protocol off-chain (`View` / `Action.step`, the fixed-point curve) for simulation and what-if. Golden-tested against the core. *(Not yet published.)* |

The core exposes the protocol's whole runtime as pure, `&Clock`-free views, so it can
answer every effective value on-chain, at any `t`, with drift zero — re-deriving the
contract in TypeScript (the mirror) is opt-in, not the default.

## Development

```bash
npm install        # workspaces: links @usufruct-protocol/{sdk,sim}
npm run build      # tsc -b
npm run lint
npm test           # vitest
```

Live on Sui **testnet** (`v1.4.7`), source-verified on-chain. Don't assume code works
by reading it — build against testnet and let the chain be the arbiter.

## License

Apache-2.0
