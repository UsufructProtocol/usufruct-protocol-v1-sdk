# Probe — the escalation ladder

**Primitive under test:** `escrow.escalationLadder()` — the third parameterized view
this batch added (`ascending_floor_with`), surfaced on the handle.
**Question:** can a governor (or a bidder) *see* a market's bid-escalation policy — how
fast the bar rises when the asset is contested?

`escrow.nextFloorPrice(bid, tenures)` answers **one** step: what the bar becomes if I bid
now. The ladder answers the whole staircase — from the current floor, the price a
challenger must clear after each **successive** displacement, `f(start), f(f(start)), …`.

## What you see

Two markets at the same `0.5` floor, one `fixed(+0.05)`, one `compound(20% + 0.001)`:

```
   step    fixed(+0.05) — linear      compound(20%) — convex
   # 0     0.5000 ████                0.5000 ████
   # 5     0.7500 ██████              1.2516 ██████████
   #10     1.0000 ████████            3.1218 ████████████████████████
```

The policy's shape is read straight off the bars:

- **fixed delta** → a **linear** ladder — every rung adds the same `+0.05`.
- **compound delta** → a **convex** ladder — each rung adds a fraction of the last
  (`+0.12` early, `+0.21` later), compounding away.

Useful when **setting** escalation (how aggressively does my market defend an incumbent?)
and when **bidding** (what does it cost to hold the asset across N challenges?).

## How it's computed

Each rung is `ascending_floor_with(prev_floor, tenures, &escalation)`. In a PTB the **u64
return** of one call can feed the **u64 argument** of the next, so the whole ladder chains
in **one `simulateTransaction`** — the escalation policy is built on-chain once (`ensemble::
new_price_*`) and reused by reference; the rungs are the last N commands. No `graphql`
(reads the live ensemble). See `packages/sdk/src/read/curve.ts` (`sampleEscalationLadder`).

## Run it

From the monorepo root (build the SDK first: `npm install && npm run build`):

```bash
npx tsx examples/escalation-ladder/index.ts
```

Needs a funded testnet signer (`SUI_PRIVATE_KEY` or the `usufruct-sdk-testnet` alias).
Fast — no tenure/descent waits. Testnet only.
