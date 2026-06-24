# Quickstart — `@usufruct-protocol/sdk`

The TypeScript SDK for the **Usufruct Protocol**: an on-chain rental market for any
Sui asset, priced in any coin. This guide takes you from `npm install` to a full
rental lifecycle, explaining each step.

> **One sentence to hold onto:** every object is its **identity** plus five verbs —
> **`nav · read · inspect · react · write`** — and the same shape repeats on the root
> handle `u` and on every object. Learn it once; it's the whole API.

---

## 1. Install

```bash
npm i @usufruct-protocol/sdk @mysten/sui
```

The SDK's only runtime dependency is `@mysten/sui`, so `npm i @usufruct-protocol/sdk`
pulls it for you — install it explicitly too, since you'll import its types directly
(`Ed25519Keypair`, `Transaction`, …).

## 2. Connect — build the lens

`usufruct()` is the single entry point. It hides the transport, the deployment ids,
and (optionally) your signer.

```ts
import { usufruct } from '@usufruct-protocol/sdk';

// Reads only — anonymous. Picks the network's RPC + GraphQL endpoints automatically.
const u = usufruct({ network: 'testnet' });
```

To **write**, give it something that can sign. Identity ("who am I") and signing
("how do I authorize") are separate axes — pick what fits:

```ts
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

// (a) a held keypair — backend/scripts. Sugar for identity + signing at once.
const u = usufruct({ network: 'testnet', signer: Ed25519Keypair.fromSecretKey(KEY) });

// (b) a browser wallet — it exposes your address but signs remotely.
const u = usufruct({ network: 'testnet', account: walletAddress });
u.connect(myWalletExecutor);      // build it from the wallet's signTransaction (see examples/wallet-demo)

// (c) anything custom — Ledger, a gas-station sponsor, a multisig — is an `Executor`.
const u = usufruct({ network: 'testnet', executor: myExecutor });
```

**Config options** (all optional):

| option | default | what it does |
|---|---|---|
| `network` | `'testnet'` | builds the gRPC client + picks the RPC and GraphQL endpoints |
| `client` | — | bring your own transport (gRPC / JSON-RPC); overrides `network` |
| `signer` | — | a held `Signer` (keypair) = identity **and** signing |
| `account` | — | identity only (an address) — for remote/wallet signing |
| `executor` | — | the signing adapter for `.send()` (wallet / Ledger / sponsor / multisig) |
| `packageId` / `feeRefId` | the network's | the deployed protocol ids — you rarely set these |
| `graphql` | the network's | endpoint for `inspect.*` (discovery/history); `false` to disable |
| `retry` | on | rides through transient public-fullnode faults; `false` to disable |

Reads need none of the signing options. Discovery (`inspect.*`) uses `graphql`, which
now defaults from `network` — so `usufruct({ network: 'testnet' })` already has it.

## 3. The five verbs

Pick the object you hold, then `.nav` / `.read` / `.inspect` / `.react` / `.write` on
it. Identity (the object's *name*) is the only flat property; everything else is a
verb and is always `await`-ed.

| verb | answers | delivery |
|---|---|---|
| **nav** | *where* — walk to a related object | returns a handle |
| **read** | *what is* — live on-chain state | `simulateTransaction` over the views |
| **inspect** | *what happened* — the event log | pull (GraphQL) |
| **react** | *what happens* — the event log | push (gRPC firehose) |
| **write** | *what I change* | a transaction (`Plan`) |

The root `u` has the same five at protocol scope (`u.nav.escrow(id)` opens the first
handle; `u.inspect.governedBy(addr)` is global discovery; `u.write.integrate(…)` is
genesis).

## 4. A full lifecycle

### 4.1 Genesis — list an asset (`write.integrate`)

Wrap an owned object into a rental market. It mints **three independent bearer
objects** — returned as separate handles, all initially yours, transferable apart.

```ts
import { SUI } from '@usufruct-protocol/sdk';

const { escrow, governanceCap, earningsInbox } = await u.write.integrate({
  asset: '0x…',                    // an owned object id (key + store)
  coin: SUI,                       // the escrow's immutable payment coin
  market: {                        // the mutable policy
    restPrice: SUI(0.01),          // floor when idle
    tenure: '1h', multiTenure: false,
    creditShape: 'linear', auctionShape: 'linear',
    descent: 'off', handover: '15s',
    escalation: { fixed: SUI(0.001) },
    retireCommitment: 'immediate', ensembleCommitment: 'immediate',
  },
}).send();
```

- `coin` is a `CoinTag` — a callable that builds prices: `SUI(0.5)` → a `Price`. For a
  non-SUI coin, resolve its decimals/symbol once: `const USDC = await u.coinType('0x…::usdc::USDC')`.
- `coin` is **not** a `Market` field — it is the escrow's immutable `phantom CoinType`,
  fixed at genesis.
- The handles are independent: move `governanceCap` and the income still flows to
  `earningsInbox`. **Moving the object moves the role.**

**`Duration` — the time fields** (`tenure`, `handover`, `descent`, `deferredFor`, …)
take a suffixed string or a raw number of **milliseconds**:

```ts
type Duration = `${number}${'ms' | 's' | 'm' | 'h' | 'd'}` | number;
```

| Suffix | Unit | Example → ms |
|---|---|---|
| `ms` | milliseconds | `'500ms'` → 500 |
| `s` | seconds | `'25s'` → 25 000 |
| `m` | **minutes** | `'30m'` → 1 800 000 |
| `h` | hours | `'1h'` → 3 600 000 |
| `d` | days | `'7d'` → 604 800 000 |

- The suffix for **minutes is `m`, not `min`** — `'30min'` is rejected (the type
  won't compile; a dynamically-built string throws `invalid duration: 30min`).
- `'30m'` (minutes) vs `'30ms'` (milliseconds) are unambiguous — `ms` is matched first.
- A raw number is milliseconds: `{ deferredFor: 1_800_000 }` ≡ `'30m'`.
- Durations are **relative spans**. The contract turns them absolute on-chain by
  reading Sui's `Clock` at execution time (e.g. `deferredFor: '7d'` → `unlock_at =
  anchor + 604 800 000 ms`) — your machine's clock is never involved.

### 4.2 Read the state (`read.assetState`)

`assetState()` is a discriminated union — it narrows to each phase's data:

```ts
const s = await escrow.read.assetState();
switch (s.kind) {
  case 'idle':     s.floor; break;                                    // free to take at the floor
  case 'occupied': s.cap; s.usufructuary; s.stake; s.expiresAt; break;
  case 'demand':   s.challenger; s.bid; s.handoverExpiresAt; break;   // a challenge is running
  case 'descent':  s.from; s.floor; s.expiresAt; break;              // Dutch auction
  case 'retired':  break;
}
```

Everything the protocol exposes as a view has a home on `read`, auto-rendered into the
high-level vocabulary (mist → `Price`, ms → `Date`):

```ts
await escrow.read.floorPrice();    // a Price, in the escrow's own coin
await escrow.read.market();        // the full policy back as a Market
await escrow.read.cycle();         // resolved floor/ceiling/handover/descent
await escrow.read.expiresAt();     // a Date | null
await escrow.read.nextBoundaryAt();// the next phase boundary (a keeper schedules on this)
```

`Price` keeps `.mist` exact for assertions/PTBs and prints itself: `${price}` →
`"0.50 SUI"`.

### 4.3 Rent — take the right of use (`write.rent`)

```ts
const cap = await escrow.write.rent({ tenures: 1 }).send();   // pays the floor by default
// overpay → the surplus becomes stake (more credit / time):
const cap = await escrow.write.rent({ tenures: 1, pay: escrow.coin(0.5) }).send();
// rent on behalf of someone — the cap lands with `to`, atomically (you still pay):
const cap = await escrow.write.rent({ tenures: 1, to: buyerAddress }).send();

cap.id;                 // the UsufructCap object id (your right of use)
cap.receipt?.paid;      // a Price — what you paid
cap.receipt?.expiresAt; // when this tenure ends
```

> **`to` directs the minted object.** `rent`, `integrate`, and `claim` mint owned
> objects and send them to the sender by default — pass `to` to redirect them in the
> *same* transaction (atomic, no second transfer). `integrate` takes a structured
> `to: { governanceCap?, earningsInbox? }` since it mints two. For routing a minted
> object straight into another Move call, drop to the bare actions (`u.primitives` /
> `@usufruct-protocol/sdk/actions`).

`rent` returns a `UsufructCap` handle. The coin is the escrow's own — auto-sourced
from your balance; you only choose the number.

### 4.4 Use the asset — `borrow` (`cap.write.borrow`)

The keystone: borrow the asset, run your code, return it — the return is appended for
you, in **one PTB**.

```ts
const { digest, returned } = await cap.write.borrow((asset, tx) => {
  // `asset` is the unwrapped object; compose any Move calls around it.
  const out = tx.moveCall({ target: '0x…::game::play', arguments: [asset] });
  tx.transferObjects([out], myAddr);
}).send();
```

`borrow` is variadic — `cap.write.borrow(useA, useB)` composes recipes in order.

### 4.5 React to a challenger (`react`)

Usufruct is always-liquid: anyone can bid on an occupied escrow, and the sitting
tenant gets a guaranteed handover window. Watch for it without polling:

```ts
// resolve once a predicate holds (async, over the handle); resolves to the handle.
const challenged = await escrow.react.waitFor(
  async e => (await e.read.assetState()).kind === 'demand',
);

// or react to a specific typed event, one-shot or continuously:
const bid = await escrow.react.next('BidPlaced', { timeoutMs: 120_000 });
const stop = escrow.react.on('BidPlaced', ev => counterBid(ev.data));
```

### 4.6 Settle and collect (`write` + `react`/`inspect`)

State transitions are **lazy** — they execute on the next write that touches the
escrow. Any write applies them; or force it explicitly:

```ts
await escrow.write.applyPendingTransitionStates().send();   // permissionless keeper
```

Settlement splits the consumed credit 90/10 (governor / protocol). Collect the
governor's cut:

```ts
await earningsInbox.read.balance();              // pending income, per coin (preview)
const got = await earningsInbox.write.collect().send();   // banks it, partitioned by coin
await earningsInbox.inspect.totals();            // lifetime income per coin (from events)
```

## 5. Governance — `GovernanceCap`

One cap governs a *portfolio*, so the per-escrow writes name their target escrow:

```ts
await governanceCap.write.updateMarket(escrow, { restPrice: escrow.coin(0.02) }).send();  // a Partial<Market>
await governanceCap.write.retire(escrow).send();
await governanceCap.write.claim(escrow).send();            // unwrap the asset back
await governanceCap.write.integrateIntoPortfolio(asset, coin, market, { earningsInbox: earningsInbox.inboxId }).send();
await governanceCap.write.transfer(treasury).send();        // hand off governance

await governanceCap.read.governs(escrow);                   // does this cap govern it?
await governanceCap.inspect.escrows();                      // its portfolio
await governanceCap.inspect.revenueByEscrow();              // earnings attributed per asset
```

## 6. Discovery & history — `inspect`

Pull the typed, decode-free event log. Discovery is **object-centric** (by
possession), so it's never an address-only query — it intersects owned objects with
the log. Needs a `graphql` endpoint (on by default).

```ts
await u.inspect.governedBy(addr);     // escrows `addr` governs now (holds the cap)
await u.inspect.rentedBy(addr);       // escrows `addr` rents now
await u.inspect.byCoinType(coinType); // escrows priced in a coin

await escrow.inspect.history();       // the escrow's whole lifecycle, time-ordered
await escrow.inspect.tenancies();     // the occupancy ledger, per-tenancy economics
await escrow.inspect.priceTimeline(); // discrete prices + descent curves, drift-zero from events
await cap.inspect.statement();        // the renter's P&L: paid / consumed / refunded
```

## 7. Writes are deferred — the `Plan`

Every write returns a `Plan`. Nothing touches the chain until you resolve it:

```ts
const plan = escrow.write.rent({ tenures: 1 });
await plan.send();                       // build → sign (handle's executor) → decode
await plan.send(otherExecutor);          // same write, different signer (sponsor/wallet/multisig)
const tx = await plan.toTransaction(me); // build-only — sign elsewhere
await plan.build(tx, me);                // drop into your own PTB (sponsorship, batching)
await u.batch(planA, planB).send();      // several writes, ONE atomic transaction
```

This is what makes sponsored rent, multisig governance, and offline signing compose:
the default executor is just a default — every `.send()` can swap it.

## 8. Authority is possession — there is no `role()`

A "governor" / "usufructuary" / "earnings collector" is not an identity the SDK
tracks; it is *whoever holds the corresponding bearer object right now*. So "can I?"
is answered by the canonical views, not a permission read:

```ts
!(await escrow.read.isRetired());                 // I can rent (the market is open)
await cap.read.isActive();                        // I hold the active seat → I can borrow
(await u.inspect.governedBy(me)).some(l => l.escrowId === escrow.id);  // I govern it

// the primitive the above compose over — does an address own a specific object?
import { ownedIds } from '@usufruct-protocol/sdk';
(await ownedIds(client, me, `${pkg}::governance_cap::GovernanceCap`)).has(capId);
```

## 9. Escape hatch — the kernel

The high-level handles render; for the raw, un-rendered views (policy unions, exact
bigints) drop to the kernel `Reader` at the root:

```ts
const reader = u.primitives.reader({ packageId, escrowId: escrow.id, typeArguments: [escrow.assetType, escrow.coinType] });
await reader.accruedCreditMist(Date.now());   // any of the ~80 deployed views, exact
```

`@usufruct-protocol/sim` is the opt-in mirror — re-derives the protocol off-chain
(simulation, what-if), golden-tested against this core.

## 10. Where next

- [`API.md`](./API.md) — the complete public API surface (every handle, verb, signature).
- [`concepts/api-design.md`](./concepts/api-design.md) — drift-zero · object-centric ·
  navigable · the five verbs (and why possession is the role).
- [`concepts/write-model.md`](./concepts/write-model.md) — `Plan`, `send` vs `build`,
  sponsored/multisig signing.
- [`concepts/borrow.md`](./concepts/borrow.md) — composing code around the borrowed asset.
- [`concepts/primitives.md`](./concepts/primitives.md) — primitives vs high-level.
- [`scripts/`](./scripts) — runnable, testnet-validated examples of every flow.
- [`llms-full.txt`](./llms-full.txt) — the self-contained payload for AI agents.

> Live on Sui **testnet** (`v1.4.7`), source-verified on-chain. Don't assume code works
> by reading it — build against testnet and let the chain be the arbiter.
