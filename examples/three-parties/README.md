# Probe — the three parties of a settlement

**Primitives under test:** `usufructCap.statement()`, `escrow.tenancies()`,
`governanceCap.revenueByEscrow()` — the renter, the asset, and the governor, each as an
event-sourced ledger.
**Question:** every settlement splits three ways (governor earnings, protocol fee, renter
stake). The inbox views gave the first two; can we read the **renter's** side, and
attribute the governor's earnings **per asset** and the asset's history **per occupant** —
all drift-zero from the log?

```ts
const pnl       = await usufructCap.statement();        // paid / refunded / consumed (+ live remaining)
const ledger    = await escrow.tenancies();             // who held it, from→to, with economics
const byAsset   = await governanceCap.revenueByEscrow();// earnings attributed per escrow
```

## What it does

Lists **A** (40s tenure, **handover 10s** so a challenger displaces the tenant *mid-tenure*)
and **B** (plain 15s) under one governor. Then:

1. Alice rents A. Bob outbids her. The 10s handover window closes part-way through Alice's
   tenure → **Alice is displaced with a partial refund**.
2. Alice rents B and runs it to expiry.

Reading back, the three ledgers **reconcile against each other**:

```
① capA.statement():  paid 0.50  consumed 0.178875  refunded 0.321125   (paid == consumed + refunded)
② tenancies(A):      Alice 00:29:57→00:30:14  used 0.178875  refund 0.321125   ← refund matches ①
                     Bob   00:30:14→now (ongoing)
③ revenueByEscrow(): A 0.1609875   B 0.45        Σ = 0.6109875  == earningsInbox.totals()
```

- **statement** reconciles internally: `paid == consumed + refunded` (a closed cap settles
  fully; an active cap's `remaining` is overlaid live).
- **tenancies**' refund for Alice equals her **statement**'s refund — the asset's view and
  the renter's view agree.
- **revenueByEscrow** sums to the inbox's `totals()` — the per-asset axis reconciles with
  the per-coin axis. (A earns 0.161 = 90% of Alice's 0.1789 used credit; B earns 0.45 = 90%
  of Alice's full 0.5.)

The renter's `consumed` is the missing third of the 90/10 split: governor 90% + protocol
10% of `consumed` is exactly what the asset gave up.

## How

All three are pure projections over the decoded event log (`RentStarted`, `BidSuperseded`,
`HandoverCompleted`, `TenureExpired`, `EarningsMessagePosted`) — no new protocol views.
`statement` overlays the live `activeStakeBalanceRemainingMist` only for a still-active cap.
See `packages/sdk/src/highlevel/ledger.ts`.

## Run it

From the monorepo root (build the SDK first: `npm install && npm run build`):

```bash
npx tsx examples/three-parties/index.ts
```

Needs a funded testnet signer (`SUI_PRIVATE_KEY` or the `usufruct-sdk-testnet` alias) for
Alice plus gas for one funded challenger (Bob), and a GraphQL endpoint. ~80s. Testnet only.
