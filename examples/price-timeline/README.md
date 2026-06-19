# Probe — historical price/credit timeline (drift-zero from events)

**Primitive under test:** the event log as a complete, replayable record of every
curve the chain ever computed.
**Question:** can a consumer redraw an escrow's **past** curves — each tenure's
credit accrual, each Dutch-auction descent — reading **only events**, byte-for-byte
as the chain computed them, even across an ensemble update that **changes the curve
shape**?

This is the sequel to the [price-curve](../price-curve) probe. That one drew *live*
curves and surfaced the O(N) read cost. This one asks the harder question — *history*
— and it needed a protocol change to answer.

## What it does

Lists an asset (`creditShape: exponential(+4)`, `auctionShape: logistic`, 20s tenure,
30s descent), then drives two full cycles and **renders the reconstruction through the
`escrow` handle methods**:

```ts
const credit = await escrow.creditCurve();    // current tenure's accrual curve
const descent = await escrow.descentCurve();  // current Dutch-auction floor curve
const history = await escrow.creditHistory(); // every tenure, each with its shape
const timeline = await escrow.priceTimeline();// acquisitions + descent curves, in order
```

1. **Cycle 1 — credit (exponential).** Rent overpaying. `escrow.creditCurve()` rebuilds
   the tenure's accrual from `RentStarted` (stake, phase start, ceiling) +
   `CycleParamsResolved` (the credit shape). Compared against live `accruedCreditMist(t)`
   — **identical**.
2. **Cycle 1 — descent (logistic).** Let the tenure expire into a Dutch auction.
   `escrow.descentCurve()` rebuilds the floor from `TenureExpired` (last-acquisition
   price, phase start) + `CycleParamsResolved` (floor, window, auction shape). Compared
   against live `floorPriceMist(t)` — **identical**.
3. **Flip the shape.** Governance updates `creditShape` → `logistic`.
4. **Cycle 2 — credit (logistic).** Rent again. `escrow.creditHistory()` returns both
   tenures from the **same log** — cycle 2 with the new shape, from its own
   `CycleParamsResolved`.

```
cycle 1 credit @ half-tenure (exponential): 0.0596 DUMMY
cycle 2 credit @ half-tenure (logistic):    0.2500 DUMMY   ← same escrow, same log, different shape
```

Every reconstructed point equals the live view at every timestamp — the **drift-zero**
guarantee, proven on testnet (35/35 points identical across the three curves).

## Why it needed a protocol change

The live curve views (`floorPriceMist`/`accruedCreditMist`) only read the *current*
state — useless for a past cycle whose state is long gone. The continuous curves have
exactly one policy input that isn't already in events: the **curve shape**. So this
deploy added:

- **parameterized pure views** `escrow::{descent_floor_at, used_credit_at}` (and
  `ascending_floor_with`) — fed entirely by event params + a shape, no `&Escrow`; and
- the per-cycle **shape/escalation policies in `CycleParamsResolved`**, so the log is
  self-contained.

The SDK feeds the view the shape it decodes from the *same* event, constructed on-chain
via the public `ensemble::new_*` facade — the enum end to end, no hand-rolled descriptor
([drift-zero seam](../../SPEC.md)). Contrast with [price-curve](../price-curve)
(SDK-only fix) and [keeper-bot](../keeper-bot) (`next_boundary_ms`, also a protocol view):
some gaps are SDK-side, some protocol-side — this one is both.

## It also closes the price-curve finding

The reconstruction samples a view at N timestamps in **one** `simulateTransaction`:
the shape is built once and reused by reference across all N points
(`packages/sdk/src/read/curve.ts`). Measured here: **3 sims for 35 points**, versus
**35 sims** for the live Pattern-A reads — ⌈N/39⌉, not N.

## Run it

From the monorepo root (build the SDK first: `npm install && npm run build`):

```bash
npx tsx examples/price-timeline/index.ts
```

Needs a funded testnet signer (`SUI_PRIVATE_KEY` or the `usufruct-sdk-testnet` alias)
and a GraphQL endpoint for event history (the testnet default is wired in). ~60s (two
short tenure/descent waits). Testnet only.
