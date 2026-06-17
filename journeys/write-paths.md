# Write paths — `Plan`, `send`, `build`, and who drives the transaction

> Every write in the SDK is a **`Plan<T>`**: a deferred value that does nothing
> until you act on it. A write has three phases —
>
> - **build** — append the PTB commands (may source coins; takes the sender address)
> - **execute** — sign + send + wait (the pluggable `Executor`)
> - **decode** — turn the effects into the typed result (`UsufructCap`, amounts, …)
>
> `send()` runs all three for you; `build()` hands you phase 1 and lets you drive
> the rest. Reads never send; a write never touches the chain until you say so.
> This is the whole model — two paths over the same three phases.

## The two paths

The only real question is **who owns the transaction — the SDK, or you?**

| | `send()` | `build()` |
|---|---|---|
| Owns the `tx` | the SDK (fresh tx) | **you** |
| Runs execute + decode | the SDK | **you** |
| Returns | the typed result `T` | nothing — it appended to your `tx` |
| Use for | one write | composing many writes / raw commands / external signing |

```
send(exec?)         =  build(new tx)  →  execute  →  decode   →  returns T
toTransaction(me)   =  build(new tx)                            →  returns the unsigned tx
build(tx, me)       =  append to YOUR tx                        →  you run execute + decode
```

`send` is `build` + execute + decode on a fresh transaction. `build` is the open
seam everything else is composed from.

## Path 1 — `send()`: let the SDK drive (the 90%)

```ts
const cap = await escrow.rent({ tenures: 1 }).send();
await governanceCap.updateMarket(escrow, { restPrice: escrow.coin(0.02) }).send();
const amounts = await earningsInbox.collect().send();
```

One write, one transaction. `build`/`decode` stay hidden. `.send()` uses the
executor configured on the session (`usufruct({ signer })`); pass one to override:

```ts
// sign with a wallet / Ledger / sponsor instead of the configured signer —
// the rich typed result still comes back (the executor returns the effects, the SDK decodes).
const cap = await escrow.rent({ tenures: 1 }).send(walletExecutor);
```

Identity and signing are separate: `account` (who I am — reads + the build-time
sender) is public; the `Executor` (how I sign) is what `send` swaps. `signer` is
sugar for both.

## Path 2 — `build()`: you drive the transaction

`build(tx, sender)` appends a write's commands to a transaction you own. You then
execute once and decode each result. This unlocks what `send` can't:

### Compose several writes into one atomic PTB — `u.batch`

`u.batch(...plans)` is the ergonomic way: it returns a `Plan` whose result is the
tuple of each plan's result. One `.send()` builds them all into one PTB, executes
once, and decodes each — all-or-nothing, in `build` order.

```ts
// atomic governance: change the market on two escrows in one transaction
const [a, b] = await u.batch(
  govA.updateMarket(eA, { restPrice: eA.coin(0.02) }),
  govB.updateMarket(eB, { restPrice: eB.coin(0.03) }),
).send();
```

A batch is itself a `Plan`, so it composes: `.send(executor)`, `.build(tx, me)`,
`.toTransaction(me)`.

**The decode caveat.** A batch is exact for **digest-only** writes (governance,
`transfer`), for `collect`, and for writes that create **distinct** object types.
Batching several writes that mint the **same** type (e.g. two `rent`s) still
executes correctly — the tx is atomic and both objects are created — but the SDK
cannot attribute each created object to its plan from the shared effects, so the
returned handles collide. For those, use separate `.send()`s, or re-fetch by id.

### The lower-level seam — `build` it yourself

When you need full control (mix raw commands, a custom executor, an external
wallet), drive the three phases by hand. This is what `batch` is built on:

```ts
import { Transaction } from '@mysten/sui/transactions';
import { signerExecutor } from '@usufruct-protocol/sdk';

const tx = new Transaction();
const ME = signer.toSuiAddress();

const rentPlan = escrow.rent({ tenures: 1 });
await rentPlan.build(tx, ME);            // ① append
const collectPlan = inbox.collect();
await collectPlan.build(tx, ME);         // ① append

const res = await signerExecutor(client, signer).execute(tx);   // ② execute once

const cap     = await rentPlan.decode(res);     // ③ decode each, from shared effects
const amounts = await collectPlan.decode(res);
```

### Mix raw Sui commands around a write

```ts
await escrow.rent({ tenures: 1 }).build(tx, ME);
const fee = tx.splitCoins(tx.gas, [1_000])[0]!;   // your own command, mid-PTB
tx.transferObjects([fee], TREASURY);
```

### The borrow bracket nests through `build` too

```ts
await cap.borrow(useAndKeepCoupon(BOB)).build(tx, ME);
// borrow_asset … return_asset land inside THIS tx, alongside everything else
```

## `toTransaction()` — build-only, you sign elsewhere

When the effects come from outside the SDK — a browser wallet, Ledger, an offline
signer — take the unsigned PTB, have it signed/sent there, then `decode` the
effects yourself:

```ts
const plan = escrow.rent({ tenures: 1 });
const tx   = await plan.toTransaction(ME);     // unsigned PTB
const res  = await wallet.signAndExecute(tx);  // executed outside the SDK
const cap  = await plan.decode(res);           // turn the effects into the typed result
```

`toTransaction(me)` is just `build` into a fresh transaction.

## When the dev touches `decode`

Almost never. `send()` hides it; composing via `build()` only exposes it because
*you* ran execute. The one irreducible case is the build-only path above: the SDK
didn't see the execution, so you hand it the effects to interpret.

| Path | Touch `decode`? |
|---|---|
| `await write().send()` | no (hidden) |
| `await write().send(executor)` | no (hidden) |
| `build()` + your own execute | yes — you ran it |
| `toTransaction()` + external wallet | yes — effects came from outside |

## Single tx vs many transactions

`build()` composes writes that share **one** PTB — only valid for **independent**
writes. Writes that depend on the previous one's *on-chain* result need separate
transactions, each with its own `send()`:

```ts
const cap = await escrow.rent({ tenures: 1 }).send();   // tx1
await sleep(handover);                                   // the new cap isn't active yet
await cap.borrow(recipe).send();                         // tx2 — cannot share tx1
```

This is not a limitation of the SDK but of the protocol (the handover window): two
real transactions, two honest `send()`s.

## Decision guide

| You want… | Path |
|---|---|
| One write, the SDK signs (keypair) | `await write().send()` |
| One write, a wallet / Ledger / sponsor signs | `await write().send(executor)` |
| One write, hand off the PTB (offline / external wallet) | `await write().toTransaction(me)` → decode after |
| Several independent writes, one atomic tx | `await u.batch(planA, planB).send()` |
| Same, with full control / raw commands / external wallet | `build()` each → `execute` once → `decode` each |
| Writes that depend on each other's chain result | separate `send()`s (multi-tx) |

## The principle

> A write is **build → execute → decode**. `send()` does all three (the common
> path); `build()` opens the middle so you can compose, batch, sponsor, or sign
> elsewhere. Nothing sends until you call `send()` (or run the tx yourself) — reads
> read, writes wait. The repetition of `.send()` is the price of that honesty, and
> it collapses to one call whenever you compose writes into a single transaction.

See [borrow composition](./borrow-composition.md) for the `Use`/`Plan.build`
bracket in depth, and [read · write · inspect · react](./read-write-inspect-react.md)
for where writes sit among the four verbs.
