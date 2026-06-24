# @usufruct-protocol/sdk

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)
[![npm](https://img.shields.io/npm/v/@usufruct-protocol/sdk.svg)](https://www.npmjs.com/package/@usufruct-protocol/sdk)

The **drift-zero core** of the TypeScript SDK for the **Usufruct Protocol** — an
on-chain rental market primitive for any Sui asset, priced in any payment coin.
Always-liquid, with handover protection, lazy state transitions, and composable
with any Sui protocol.

A governor wraps any owned object (`key + store`) into an **escrow** and sets the
market. Usufructuaries pay to acquire the right of use, receiving a `UsufructCap`.
A challenger can bid at any time; the current usufructuary is guaranteed a handover
window before displacement. State transitions execute lazily on the next
transaction that touches the escrow — no keeper, no cron.

- Protocol: https://github.com/UsufructProtocol/usufruct-protocol-v1
- Live on Sui **testnet** (`v1.4.7`), source-verified on-chain.

## Drift-zero by construction

This package **cannot drift from the contract**. It only ever (a) decodes BCS,
(b) does IO through `Source`, (c) reads *effective* values through the on-chain
`Reader` — which evaluates the deployed Move views via `simulateTransaction`, so
every read is the bytecode's own answer — and (d) builds PTBs via `Action.toPtb`.
It never re-derives the protocol's math in TypeScript.

That's possible because `usufruct` exposes its **entire runtime** as ~124 pure,
total, `&Clock`-free views. If you need to *re-derive* the protocol off-chain
(forward simulation across time, what-if analysis, a fully-offline testbed), reach
for the opt-in mirror [`@usufruct-protocol/sim`](https://www.npmjs.com/package/@usufruct-protocol/sim)
— golden-tested against this core.

## Install

```bash
npm i @usufruct-protocol/sdk @mysten/sui
```

`@mysten/sui` (v2) is a peer you bring — the SDK is transport-agnostic over its
clients (gRPC, JSON-RPC, GraphQL).

## Quickstart

```ts
import { usufruct } from '@usufruct-protocol/sdk';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

// Reads need no signer; writes do. `network` also picks the GraphQL endpoint that
// powers `inspect.*` discovery/history — pass `graphql` only to override it.
const u = usufruct({
  network: 'testnet',
  signer: Ed25519Keypair.fromSecretKey(process.env.SUI_PRIVATE_KEY!),
});

const escrow = await u.nav.escrow('0x…');       // resolve the handle (identity only)
const s = await escrow.read.assetState();       // live: a discriminated union
s.kind;              // 'idle' | 'descent' | 'occupied' | 'demand' | 'retired'
await escrow.read.floorPrice();                 // a Price, rendered in the escrow's own coin
(await u.inspect.governedBy(myAddr)).some(l => l.escrowId === escrow.id); // do I govern it?
```

## Identity + five verbs

Every object is its **identity** (the object's name — `escrow.id`, `cap.escrowId`,
`inbox.inboxId`) plus five verbs. Every verb is **object-centric** (ask the object,
it answers) and **decode-free** (no asset schema needed). The shape is **fractal** —
the same five sit on the root `u` and on every handle.

| Verb | What | Delivery | Example |
|---|---|---|---|
| **nav** | walk to a related object | the object graph | `escrow.nav.activeCap()`, `u.nav.escrow(id)` |
| **read** | the chain *as it is now* | `simulateTransaction` | `escrow.read.assetState()`, `inbox.read.balance()` |
| **inspect** | what *happened* | pull (GraphQL) | `escrow.inspect.history()`, `u.inspect.governedBy(addr)` |
| **react** | what *happens* | push (gRPC) | `escrow.react.watch/on`, `escrow.react.waitFor/next` |
| **write** | make it *different* | a transaction | `escrow.write.rent()`, `gov.write.updateMarket()`, `inbox.write.collect()` |

```ts
// NAV — edges between objects (each is IO, so awaited); the root opens the first handle
const escrow = await u.nav.escrow(id);
const seat   = await escrow.nav.activeCap();        // the current seat, or null

// READ — the deployed views, live & coin-rendered (no fetch-time photo, nothing stale)
await escrow.read.market();                         // the full policy
await escrow.read.creditCurve();                    // the current tenure's curve, sampled live
// raw kernel reader (un-rendered) lives at the root escape hatch, not on the handle:
await u.primitives.reader({ packageId, escrowId: escrow.id, typeArguments: [escrow.assetType, escrow.coinType] }).accruedCreditMist(Date.now());

// WRITE — each write lives on the object that authorizes it; authority is possession
await escrow.write.rent({ tenures: 1 }).send();     // pay the floor (`pay` to overpay → stake)
await gov.write.updateMarket(escrow, { restPrice: escrow.coin(0.02) }).send();
await inbox.write.collect().send();                 // 90% governor cut, partitioned by coin
await gov.write.transfer(treasury).send();          // move the object → move the role

// INSPECT — pull the typed event log, decode-free
await u.inspect.governedBy(u.address!);             // escrows whose GovernanceCap I hold
await escrow.inspect.history();                     // one escrow's lifecycle, time-ordered

// REACT — server-push over the gRPC checkpoint firehose
const stop = escrow.react.watch(e => render(e));    // every on-chain change → fresh handle
await escrow.react.next('BidPlaced', { timeoutMs: 120_000 });  // one-shot typed event
```

### Genesis — list an asset

```ts
const { escrow, governanceCap, earningsInbox } = await u.write.integrate({
  asset: '0x…',                              // an owned object id (key + store)
  coin: await u.coinType('0x2::sui::SUI'),   // immutable payment coin (decimals from chain)
  market: { /* floor, rest price, handover window, curve … */ },
});
```

`integrate` mints three **independent** bearer objects — the escrow, the
`GovernanceCap`, and the `EarningsInbox` — all initially yours and transferable
apart. Moving any of them moves the role it carries.

## Design & reference

See the [repository](https://github.com/UsufructProtocol/usufruct-protocol-v1-sdk):
`API.md` (the complete surface), `concepts/` (the [api design](../../concepts/api-design.md) —
drift-zero · object-centric · navigable · `nav · read · inspect · react · write`),
`SPEC.md` (authoritative design), and `ARCHITECTURE.md` (the drift-zero core / mirror
seam and the four primitives). `llms-full.txt` is the self-contained payload for AI agents.

## License

Apache-2.0
