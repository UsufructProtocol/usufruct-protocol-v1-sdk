# Borrow. Compose. Return.

[![npm](https://img.shields.io/npm/v/@usufruct-protocol/sdk/next?color=cb3837&logo=npm&label=npm%20%40next)](https://www.npmjs.com/package/@usufruct-protocol/sdk)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)
[![Built for Sui](https://img.shields.io/badge/Built_for-Sui-6fbcf0)](https://sui.io)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white)](https://discord.com/invite/aQpBtnE6v)

**`@usufruct-protocol/sdk`** — the official TypeScript SDK for the **Usufruct
Protocol**, an on-chain rental market primitive for **any Sui asset, priced in any
payment coin**. Always-liquid, with handover protection, lazy state transitions, and
composable with any Sui protocol.

Live on Sui **testnet** (`v1.4.7`), source-verified on-chain. Built on the
[**Usufruct Protocol**](https://github.com/UsufructProtocol/usufruct-protocol-v1) —
the on-chain primitive (its `llms.txt` is an agent guide to *what Usufruct is*; this
SDK is the *how-to*).

## What you can build

**Any Sui object that gates access to on-chain code is a natural fit** — usufruct
rents the *right to use* it (to call the functions it guards) without parting with
ownership.

- **Capabilities & access** — a `Cap`, an access pass, a license, a key: rent the
  right to call the gated functions for a tenure, while you keep the object.
- **Assets** — NFTs, game items, RWAs: any `key + store` object, priced in any `Coin<C>`.
- **A tradable right of use** — the `UsufructCap` is a bearer object: sell it, lend
  it, route it. Possession is the role.
- **Compose with all of Sui** — `borrow` hands you the asset (or the `&Cap`) mid-PTB
  to feed into any Move call (staking, AMMs, games), with a guaranteed return.

**List it, expose it to the world — and an idle Sui object in your wallet becomes a
yield-bearing asset.**

## Install

```bash
npm i @usufruct-protocol/sdk@next @mysten/sui
```

> **Release candidate** — published under the `next` dist-tag, so the `@next` is
> required (a bare `npm i` won't resolve a pre-release). `pnpm add` / `yarn add` /
> `bun add` work the same with `@next`.

## Rent and use — in 60 seconds

```ts
import { usufruct } from '@usufruct-protocol/sdk';

const u = usufruct({ network: 'testnet', signer });           // signer = your keypair
const escrow = await u.nav.escrow('0x…');
const cap = await escrow.write.rent({ tenures: 1 }).send();   // → a UsufructCap
await cap.write.borrow((asset, tx) => { /* use the asset, mid-PTB */ }).send();
```

## List an asset for rent

The other side of the market: `integrate` any `key + store` object into a fresh
escrow, set your **market** (price, tenure, auction, handover), and it's live for
anyone to rent — income flows to your `earningsInbox`, governance stays with your
`governanceCap`.

```ts
import { usufruct, SUI } from '@usufruct-protocol/sdk';

const u = usufruct({ network: 'testnet', signer });

const { escrow, governanceCap, earningsInbox } = await u.write.integrate({
  asset: '0x…',                       // any key + store object you own (a Cap, an NFT, …)
  coin: SUI,                          // the escrow's payment coin (immutable)
  market: {
    restPrice: SUI(0.5),              // the floor when idle
    tenure: '1d',                     // one tenure = one day
    multiTenure: true,                // renters may lock several tenures up front
    creditShape: 'linear',
    auctionShape: 'linear',
    descent: 'off',                   // or a Duration → a Dutch auction after expiry
    handover: '1h',                   // the tenant's guaranteed grace before displacement
    escalation: { fixed: SUI(0.05) }, // a challenger pays +0.05 over the incumbent
    retireCommitment: 'immediate',
    ensembleCommitment: 'immediate',
  },
}).send();
// live and rentable — retune anytime with governanceCap.write.updateMarket(escrow, { … })
```

→ **[QUICKSTART](./QUICKSTART.md)** walks the whole lifecycle · **[API reference](./API.md)** ·
the **[cookbook](./concepts/cookbook.md)** has it copy-paste.

## The shape, in one breath

Every object is its **identity** plus five verbs — **`nav · read · inspect · react ·
write`** — identical on the root `u` and on every handle (`Escrow` / `UsufructCap` /
`GovernanceCap` / inboxes). Reads are **drift-zero** (the deployed Move views, live).
Writes are **`Plan`s**: `.send()` runs build + sign + decode; `.build(tx, sender)` lets
you drive the PTB. See [`concepts/api-design.md`](./concepts/api-design.md).

## Don't learn the API — hand it to your agent

You don't have to read the API to use it. **[`llms-full.txt`](./llms-full.txt)** is a
self-contained documentation payload: paste it into your AI agent's context (Claude
Code, Cursor, …) and ask for the Usufruct script you want. It carries everything the
agent needs — setup, the full API surface, types, the write model, `borrow`, the
pitfalls, and runnable recipes.

> *"Here's `llms-full.txt` for `@usufruct-protocol/sdk`. Write a script that rents
> escrow `0x…` for 1 tenure and borrows the asset to call my Move function."*

[`llms.txt`](./llms.txt) is the curated index.

**Don't know how Usufruct works yet?** Same trick, one level down — load the
**Usufruct Protocol**'s [`llms.txt`](https://github.com/UsufructProtocol/usufruct-protocol-v1/blob/main/llms.txt)
into your agent: it explains *what Usufruct is* and the economics (pricing,
escalation, handover protection). That one teaches the *what*; this SDK payload is the *how*.

## Docs

- [`QUICKSTART.md`](./QUICKSTART.md) — install → a full lifecycle, step by step.
- [`API.md`](./API.md) — the complete public surface (every handle, verb, signature).
- [`concepts/`](./concepts) — api-design · write-model · borrow · primitives · cookbook · faq.
- [`SPEC.md`](./SPEC.md) · [`ARCHITECTURE.md`](./ARCHITECTURE.md) — the drift-zero design.
- [`scripts/`](./scripts) — runnable, testnet-validated examples of every flow.

## Two packages, one drift-zero seam

| Package | Role |
|---|---|
| **[`@usufruct-protocol/sdk`](./packages/sdk)** | The **drift-zero core** — decode + `Source` IO + the on-chain `Reader` + `Action.toPtb`. The high-level API lives here and reads through the `Reader`, so it **cannot drift** from the contract. Depends only on `@mysten/sui`. **Start here.** |
| **[`@usufruct-protocol/sim`](./packages/sim)** | The **opt-in mirror** — re-derives the protocol off-chain (`View` / `Action.step`, the fixed-point curve) for simulation and what-if. Golden-tested against the core. *(Not yet published.)* |

The core exposes the protocol's whole runtime as pure, `&Clock`-free views, so it can
answer every effective value on-chain, at any `t`, with drift zero — re-deriving the
contract in TypeScript (the mirror) is opt-in, not the default.

## Community

Questions, ideas, or shipping something on Usufruct? Join the
[**Discord**](https://discord.com/invite/aQpBtnE6v) — the **#sdk** channel is where
the SDK ships: releases, examples, and direct support.
