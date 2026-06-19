# Probe — the earnings ledger

**Primitive under test:** `earningsInbox.history()` / `totals()` — the event-sourced
income ledger of a coin-polymorphic inbox.
**Question:** "how much has this inbox earned, ever?" — across every coin, including
income already collected and gone.

The handle had `balance()` (the *uncollected* message objects right now) and `watch()`
(live push of new income). Neither answers the lifetime question: collected earnings have
left the inbox, and `watch()` only sees the future. The event log does — every settlement
emits `EarningsMessagePosted { earnings_inbox_id, amount, coin_type }`. So:

```ts
const log    = await earningsInbox.history();  // every message ever posted (oldest first)
const totals = await earningsInbox.totals();   // that, summed per coin
```

Both are keyed on the inbox id across **every** escrow paying in (a governor's whole
portfolio), and both are generic over the two inboxes — the same methods give the
`ProtocolFeeInbox` its deployment-wide fee take (`FeeMessagePosted`).

## What it does — multi-coin, on purpose

The inbox is **coin-polymorphic**: one governor can list assets priced in different coins,
all paying the same inbox. So this lists **two** escrows into **one** inbox —

- escrow A priced in **DUMMY** (9-decimal, free-mint) via `usufruct.integrate(…)`,
- escrow B priced in **USDC** (6-decimal, a real testnet coin) via
  `governanceCap.integrateIntoPortfolio(asset, USDC, market, { earningsInbox })` —

settles each (a 15s tenure runs to expiry, paying the governor 90% of the stake), and
reads the ledger back:

```
== earningsInbox.history()
   23:58:26    0.45 DUMMY  from 0x49a041f7…
   23:58:48     0.45 USDC  from 0x12ae7ba1…

== earningsInbox.totals()
   0.45 DUMMY  across 1 settlement(s)  (DUMMY_COIN)
    0.45 USDC  across 1 settlement(s)  (USDC)
```

`totals()` returns a **separate entry per coin**, each scaled to its own decimals
(`0.45 DUMMY` = 450000000 mist, `0.45 USDC` = 450000 mist — not 9-decimal coupled), and
each equals the sum of that coin's messages. That's the coin-polymorphic claim, proven —
not asserted by construction.

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
