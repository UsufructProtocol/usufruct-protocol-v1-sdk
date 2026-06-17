# @usufruct-protocol/sdk

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)
[![npm](https://img.shields.io/npm/v/@usufruct-protocol/sdk.svg)](https://www.npmjs.com/package/@usufruct-protocol/sdk)

The official TypeScript SDK for the **Usufruct Protocol** — an on-chain rental
market primitive for any Sui asset, priced in any payment coin. Always-liquid,
with handover protection, lazy state transitions, and composable with any Sui
protocol.

A governor wraps any owned object (`key + store`) into an **escrow** and sets the
market. Usufructuaries pay to acquire the right of use, receiving a `UsufructCap`.
The asset stays liquid: a challenger can bid at any time, and the current
usufructuary is guaranteed a handover window before displacement. State
transitions execute lazily on the next transaction that touches the escrow — no
keeper, no cron.

- Protocol: https://github.com/UsufructProtocol/usufruct-protocol-v1
- Live on Sui **testnet** (`v1.4.2`), source-verified on-chain.

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

// Reads need no signer; writes do. `graphql` enables discovery/history.
const u = usufruct({
  network: 'testnet',
  signer: Ed25519Keypair.fromSecretKey(process.env.SUI_PRIVATE_KEY!),
  graphql: 'https://graphql.testnet.sui.io/graphql',
});

const escrow = await u.escrow('0x…');  // one fetch: state @ now + "what can I do here?"
escrow.status;       // 'idle' | 'descent' | 'occupied' | 'demand' | 'retired'
escrow.floorPrice;   // a Price, rendered in the escrow's own coin
escrow.canGovern;    // do I hold this escrow's GovernanceCap? (possession = role)
```

## The four verbs

The whole surface is four verbs. Every one is **object-centric** (ask the object,
it answers) and **decode-free** (no asset schema needed). Full walk-through:
[`journeys/read-write-inspect-react.md`](./journeys/read-write-inspect-react.md).

| Verb | What | Delivery | Door |
|---|---|---|---|
| **Read** | the chain *as it is now* | a fetch | `u.escrow(id)` → handle + `escrow.reader` |
| **Write** | make it *different* | a transaction | capability methods — `rent`, `borrow`, `updateMarket`, `collect`, `transfer` |
| **Inspect** | what *happened* | pull (GraphQL) | discovery (`escrowsGovernedBy`…) + `escrow.history()` |
| **React** | what *happens* | push (gRPC) | `escrow.watch` / `waitFor`, `escrow.on` / `next` |

```ts
// READ — synchronous getters off one fetch; drop to escrow.reader for live, drift-free views
const escrow = await u.escrow(id);
await escrow.reader.accruedCreditMist(Date.now());

// WRITE — each write lives on the object that authorizes it; authority is possession
await escrow.rent({ tenures: 1 });                 // pay the floor (`pay` to overpay → stake)
await governanceCap.updateMarket(escrow, { restPrice: escrow.coin(0.02) });
await earningsInbox.collect();                      // 90% governor cut, partitioned by coin
await governanceCap.transfer(treasury);             // move the object → move the role

// INSPECT — pull the typed event log, decode-free
await u.escrowsGovernedBy(u.address!);              // escrows whose GovernanceCap I hold
const events = await escrow.history();              // one escrow's lifecycle, time-ordered

// REACT — server-push over the gRPC checkpoint firehose
const stop = escrow.watch(e => render(e));          // every on-chain change → fresh snapshot
const bid = await escrow.next('BidPlaced', { timeoutMs: 120_000 });  // one-shot typed event
```

### Genesis — list an asset

```ts
const { escrow, governanceCap, earningsInbox } = await u.integrate({
  asset: '0x…',                       // an owned object id (key + store)
  coin: await u.coinType('0x2::sui::SUI'),  // immutable payment coin (decimals from chain)
  market: { /* floor, rest price, handover window, curve … */ },
});
```

`integrate` mints three **independent** bearer objects — the escrow, the
`GovernanceCap`, and the `EarningsInbox` — all initially yours and transferable
apart. Moving any of them moves the role it carries.

## Design & reference

- [`SPEC.md`](./SPEC.md) — authoritative design. The SDK is composed from four
  primitives (`EscrowState`, `View`, `Action`, `Source`); no new core primitives.
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — the four primitives and how they compose.
- [`journeys/object-model.md`](./journeys/object-model.md) — *why* the API is
  object-centric (authority = possession; `transfer` is first-class).
- [`journeys/design-notes.md`](./journeys/design-notes.md) — design rationale and
  the live-testnet validation log accrued while building the SDK.
- [`scripts/`](./scripts) — runnable, testnet-validated examples of every flow
  (`integrate`, `rent`, challenge/handover, earnings/fee collect, watch, …).

## License

Apache-2.0
