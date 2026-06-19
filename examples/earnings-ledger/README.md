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

## What it does

Lists an asset (15s tenure, descent off → a tenure expiry settles straight to the
governor), then runs **two** tenures to completion. Each pays the governor 90% of the
stake (10% is the protocol fee). It reads the ledger back:

```
== earningsInbox.history()
   23:41:32    0.45 DUMMY  from 0x76b03986…
   23:41:53    0.54 DUMMY  from 0x76b03986…

== earningsInbox.totals()
   0.99 DUMMY  across 2 settlements  (DUMMY_COIN)
```

`totals()` equals the sum of every posted message, and each message is exactly 90% of its
stake (`0.5 → 0.45`, `0.6 → 0.54`).

## Note on indexing

`history()` reads the GraphQL event log, which lags the settling transaction by a few
seconds — the example polls until the messages land. On the singleton `ProtocolFeeInbox`
(deployment-wide) bound the scan with `afterCheckpoint`.

## Run it

From the monorepo root (build the SDK first: `npm install && npm run build`):

```bash
npx tsx examples/earnings-ledger/index.ts
```

Needs a funded testnet signer (`SUI_PRIVATE_KEY` or the `usufruct-sdk-testnet` alias) and
a GraphQL endpoint. ~40s (two short tenure waits). Testnet only.
