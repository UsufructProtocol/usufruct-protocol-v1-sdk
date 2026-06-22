# Probe — replay a longer market through the handle

**Primitive under test:** `escrow.priceTimeline()` / `escrow.creditHistory()` over a
**multi-phase** market — bids, supersedes, handovers, descents, across an ensemble update.
**Question:** does the event-sourced reconstruction hold up over the full lifecycle, not
just a single rent?

The [price-timeline](../price-timeline) probe proves the reconstruction is drift-zero on a
simple market. This one drives the **whole** state machine, twice:

```
Idle → Occupied → Demand → Demand → Demand → Demand → Occupied → Descent → Idle
  → update_ensemble (creditShape exponential(+4) → logistic) →
Idle → Occupied → Demand → Demand → Demand → Demand → Occupied → Descent → Idle
```

## How the phases are produced

- **Occupied → Demand×4.** `rent()` is polymorphic — rent when idle, **bid** when
  occupied, **supersede** when in demand. So one bid + three supersedes (from four funded
  challengers, escalating 0.6 → 0.9 DUMMY) hold the escrow in `demand` through four
  events. `handover: 'fullTenure'` keeps the sitting tenant protected to its tenure end,
  so the challengers outbid each other inside one window instead of settling immediately.
  The seats are **pre-resolved** before bidding so the four bids land back-to-back inside
  that window (a re-resolve per bid is too slow — late bids spill past the boundary and
  settle as a second handover).
- **Demand → Occupied.** At the tenure boundary the highest bid wins; `applyPendingTransitionStates`
  materializes the `HandoverCompleted` — the winner takes over.
- **Occupied → Descent → Idle.** The winner sits its tenure; with no further bids its
  expiry opens the Dutch auction, which descends to the rest price and returns to idle.

A small `driveTo(status)` loop applies at each boundary until the target phase is reached.

## What you see

`escrow.priceTimeline()` prints the whole chronology — every `rent`/`bid`/`supersede`/
`handover` price and each `descent` curve drawn inline:

```
21:26:54  rent      0.50 DUMMY  0x364ec6…
21:26:57  bid       0.60 DUMMY  0x818923…
21:27:01  supersede 0.70 DUMMY  0xaecba2…
21:27:06  supersede 0.80 DUMMY  0x983daf…
21:27:10  supersede 0.90 DUMMY  0x5164e2…
21:27:34  handover  0.901 DUMMY  0x364ec6…
21:28:10  descent   0.90 DUMMY → 0.01 DUMMY  (logistic, 18s):  █████▉…
```

`escrow.creditHistory()` draws every tenure's accrual side by side — the initial renter
**and** the handover occupant in each cycle — the first two on `exponential(+4)`, the
last two on `logistic`, all reconstructed from the one log.

## Note on timing

Bids race the handover window in **real** testnet time. The example is tuned (pre-resolved
seats, a 36s tenure) to fit four bids before the boundary; under heavy latency a late bid
can settle as an extra handover. That's faithful market behavior — the assertions check the
*structure* (a sustained Demand chain, a handover, two descents, the shape change), not
exact counts.

## Run it

From the monorepo root (build the SDK first: `npm install && npm run build`):

```bash
npx tsx examples/market-replay/index.ts
```

Needs a funded testnet signer (`SUI_PRIVATE_KEY` or the `usufruct-sdk-testnet` alias) with
~0.5 SUI for the eight challenger gas grants, plus a GraphQL endpoint. **~4 min** of real
tenure/descent waits. Testnet only.
