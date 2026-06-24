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
> required (a bare `npm i` won't resolve a pre-release). The only runtime dependency
> is `@mysten/sui`; install it explicitly too, since you'll import its types
> (`Ed25519Keypair`, `Transaction`, …).

## 60-second example

```ts
import { usufruct } from '@usufruct-protocol/sdk';

const u = usufruct({ network: 'testnet', signer });           // signer = your keypair
const escrow = await u.nav.escrow('0x…');
const cap = await escrow.write.rent({ tenures: 1 }).send();   // → a UsufructCap
await cap.write.borrow((asset, tx) => { /* use the asset, mid-PTB */ }).send();
```

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
you drive the PTB.

## Docs

- [QUICKSTART](https://github.com/UsufructProtocol/usufruct-protocol-v1-sdk/blob/main/QUICKSTART.md) — install → a full rental lifecycle, step by step.
- [API reference](https://github.com/UsufructProtocol/usufruct-protocol-v1-sdk/blob/main/API.md) — the complete public surface (every handle, verb, signature).
- [Concepts](https://github.com/UsufructProtocol/usufruct-protocol-v1-sdk/tree/main/concepts) — api-design · write-model · borrow · primitives · cookbook · faq.
- [SPEC](https://github.com/UsufructProtocol/usufruct-protocol-v1-sdk/blob/main/SPEC.md) · [ARCHITECTURE](https://github.com/UsufructProtocol/usufruct-protocol-v1-sdk/blob/main/ARCHITECTURE.md) — the drift-zero design.
- **AI agents:** [`llms-full.txt`](https://github.com/UsufructProtocol/usufruct-protocol-v1-sdk/blob/main/llms-full.txt) — a self-contained payload; load it and an agent writes working scripts without learning the API by hand.

## Two packages, one drift-zero seam

This is the **drift-zero core** — decode + `Source` IO + the on-chain `Reader`
(evaluates the deployed Move views via `simulateTransaction`) + `Action.toPtb`. The
high-level API lives here and reads through the `Reader`, so it **cannot drift** from
the contract. The opt-in mirror **`@usufruct-protocol/sim`** (off-chain re-derivation
for simulation/what-if) is a separate package, golden-tested against this core.

Live on Sui **testnet** (`v1.4.7`), source-verified on-chain.

## License

Apache-2.0
