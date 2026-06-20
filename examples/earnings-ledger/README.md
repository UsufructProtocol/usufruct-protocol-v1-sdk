# Probe — the settlement ledger (earnings + fees)

**Primitive under test:** `inbox.history()` / `totals()` — the event-sourced income
ledger of a coin-polymorphic inbox, on **both** inbox kinds.
**Question:** "how much has this inbox taken in, ever?" — across every coin, including
income already collected and gone, for the governor's earnings *and* the protocol's fees.

The handle had `balance()` (the *uncollected* message objects right now) and `watch()`
(live push of new income). Neither answers the lifetime question: collected income has
left the inbox, and `watch()` only sees the future. The event log does — every settlement
emits a `…MessagePosted { …_inbox_id, amount, coin_type }`. So:

```ts
const log    = await inbox.history();  // every message ever posted (oldest first)
const totals = await inbox.totals();   // that, summed per coin
```

Both are keyed on the inbox id across **every** escrow paying in, and both are generic
over the **two** inbox kinds — the same methods read the governor's `EarningsInbox`
(`EarningsMessagePosted`) *and* the protocol's `ProtocolFeeInbox` (`FeeMessagePosted`).

## What it does — both sides of the split, multi-coin

Each settlement is **90/10**: the governor's earnings and the protocol's fee. This lists
**two** escrows into **one** earnings inbox —

- escrow A priced in **DUMMY** (9-decimal, free-mint) via `usufruct.integrate(…)`,
- escrow B priced in **USDC** (6-decimal, a real testnet coin) via
  `governanceCap.integrateIntoPortfolio(asset, USDC, market, { earningsInbox })` —

settles each (a 15s tenure runs to expiry), and reads **both** inboxes with the same
`history()` / `totals()`:

```
   coin     stake   governor (90%)   protocol (10%)
   DUMMY    0.50      0.4500          0.0500
   USDC     0.50      0.4500          0.0500

   earningsInbox.totals():               0.45 DUMMY, 0.45 USDC
   feeInbox.totals() (deployment-wide):  0.69 DUMMY, 0.15 USDC
```

Two things are proven, not asserted by construction:

- **Coin-polymorphic** — `totals()` returns a separate entry per coin, each scaled to its
  own decimals (`0.45 DUMMY` = 450000000 mist, `0.45 USDC` = 450000 mist — not 9-decimal
  coupled), and `90% + 10% = the stake` in each coin's own units.
- **Symmetric across inboxes** — the *same* methods read the fee pool; `governor + protocol`
  reconciles to the stake. The `EarningsInbox` is the governor's (its `totals()` is just
  this run); the `ProtocolFeeInbox` is the deployment-wide singleton (its `totals()` is
  every settlement's fee), so the example filters fees to its own two escrows by id.

## Note on indexing

`history()` reads the GraphQL event log, which lags the settling transaction by a few
seconds — the example polls until the messages land. On the singleton `ProtocolFeeInbox`
(deployment-wide) bound the scan with `afterCheckpoint`.

## Run it

From the monorepo root (build the SDK first: `npm install && npm run build`):

```bash
npx tsx examples/earnings-ledger/index.ts
```

Needs a funded testnet signer (`SUI_PRIVATE_KEY` or the `usufruct-sdk-testnet` alias), a
GraphQL endpoint, and — for the USDC arm — a small **USDC** balance (~0.5; the DUMMY arm
is free-mint). ~40s (two short tenure waits). Testnet only.
