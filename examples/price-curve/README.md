# Probe — price curve (sampling a view over time)

**Primitive under test:** the curve-math read surface (`floorPriceMist(t)`,
`accruedCreditMist(t)`) + the read batching machinery.
**Question:** can a frontend cheaply **render a price curve** — sample a view at
many timestamps?

## What it does

Lists an asset with **non-trivial curve shapes** (`creditShape: exponential(+4)`,
`auctionShape: logistic`), rents it overpaying (high ceiling + big credit
principal), and renders **two** time-varying curves as ASCII, each by sampling its
view at N timestamps:

**① credit accrual over the tenure** — `accruedCreditMist(t)`, a steep exponential:

```
t+ 0s  0.0031  █
t+12s  0.1277  ███████████
t+18s  0.4455  ███████████████████████████████████████
t+20s  0.5000  ████████████████████████████████████████████
```

**② the Dutch-auction floor in descent** — `floorPriceMist(t)`, a logistic S-curve
(flat high → steep drop → flat at rest):

```
t+ 0s  0.4980  ████████████████████████████████████████████
t+20s  0.3721  █████████████████████████████████
t+30s  0.1446  █████████████
t+45s  0.0179  ██
t+60s  0.0100  █      ← rest price
```

## The finding

**Sampling a curve costs O(N) round-trips.** The curve-math views are *Pattern A* —
one read per `t`. And `reader.batch(names, opts)` batches **many views at one `t`**,
not **one view at many `t`** — so it can't help here. A frontend redrawing a live
curve pays **N `simulateTransaction` per frame** (measured: 24 reads for the 24
points across the two curves).

## The fix — and how it differs from the keeper/next_boundary probe

This one is **SDK-side, no protocol change.** A PTB can carry N
`floor_price_mist(t_i)` moveCalls in ONE transaction, so a single
`simulateTransaction` returns all N points — the same multi-call/one-sim machinery
the Reader already uses for `batch` (many views, one `t`), just turned the other
way (one view, many `t`). Proposed:

```ts
// one round-trip for the whole curve:
const curve = await escrow.priceCurve({ from, to, step });   // Array<{ t, floor }>
// or, lower-level:  reader.floorPriceCurve(times: Ms[])
```

Contrast with the keeper probe: there, the descent **boundary** wasn't exposed
on-chain at all, so the fix had to be a new protocol view (`next_boundary_ms`) +
a redeploy. Here the data is already reachable; only the SDK's *read shape* is
missing. **Some gaps are protocol-side, some are SDK-side — this probe is the
SDK-side kind.** (A protocol `floor_prices_at(times[])` view would only be worth
it if the N-call PTB ever hits a `simulateTransaction` command limit.)

## Run it

From the monorepo root (build the SDK first: `npm install && npm run build`):

```bash
npx tsx examples/price-curve/index.ts
```

Needs a funded testnet signer (`SUI_PRIVATE_KEY` or the `usufruct-sdk-testnet`
alias). ~30s (one short tenure wait). Testnet only.
