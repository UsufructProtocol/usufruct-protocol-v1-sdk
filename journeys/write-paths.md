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

The two paths are two narratives:

- **The SDK drives** (`send`) — you hand over a `Plan`; the SDK builds a fresh tx,
  signs it with the session's executor (or one you pass), waits, and gives you the
  typed result. You write one line.
- **You drive** (`build` / `toTransaction`) — the SDK only contributes the write's
  commands to a transaction *you* hold; you decide when to execute, with what, and
  you decode. You get control: compose many writes, mix raw Sui commands, sign with
  a wallet/Ledger/sponsor, or sign offline.

## Identity and signing — `signer`, `account`, `executor`

A write touches **two** concerns, and the SDK keeps them separate because they are
needed at different moments:

- **Identity** (`account`) — *who I am*, an address. Needed at **build** time (the
  transaction sender; sourcing the payment coin) and by **reads** (role resolution:
  am I the governor? the active renter?). It is public — a wallet exposes its
  address without handing over keys.
- **Signing** (`executor`) — *how a transaction is executed*: `{ address, execute(tx) }`.
  Needed only at **execute** time. A keypair, a browser wallet, a Ledger, a sponsor
  flow, an offline signer — each is just a different `Executor`.

`signer` is **sugar for both**: a held keypair both *is* an identity and *can* sign.

```
signer  =  account  +  executor
           (address)    (signerExecutor(client, signer))
```

And note the asymmetry: an `Executor` already carries its own `address`, so
**`executor` contains `account`**, but `account` alone cannot sign. That is why a
standalone `account` is the read-only / external-wallet case — identity now, the
executor supplied per `.send(executor)`.

```
account   =  "who I am"        (address; build + reads)
executor  =  "how I sign"      ( = address + execute )   → contains account
signer    =  "I hold the key"  ( → account + executor )  → sugar for both
```

### How the session resolves them

`usufruct({...})` resolves identity and the default executor live (so `connect`
can rebind either). From `usufruct.ts`:

```ts
resolveAccount  = () => account ?? executor?.address ?? signer?.toSuiAddress() ?? null;
resolveExecutor = () => executor ?? (signer ? signerExecutor(client, signer) : null);
```

### The three ways to configure

```ts
import { usufruct, signerExecutor } from '@usufruct-protocol/sdk';

usufruct({ network: 'testnet', client, signer });    // keypair: SDK can sign by itself
usufruct({ network: 'testnet', client, executor });  // wallet/Ledger adapter as the default signer
usufruct({ network: 'testnet', client, account });   // identity only — .send() requires .send(executor)
```

| Config | `account` (identity) | default executor | `.send()` with no args |
|---|---|---|---|
| `{ signer }` | `signer.address` | `signerExecutor(client, signer)` | signs with the keypair |
| `{ executor }` | `executor.address` | `executor` | signs with the adapter |
| `{ account }` | `account` | **none** | throws `NotConnected` — pass `.send(executor)` |
| `{ client }` only | `null` | none | reads that need a role fail; writes need `.send(executor)` |

So the executor a write uses is: **the one you pass to `.send(executor)`**, else
**the session default**, else `NotConnected`. The `account` (build-time sender) is
always the session identity (or the address of the executor you pass).

## The paths by example

A runnable catalog — every path once. The sections after this explain each in depth.

### Setup — identity + signing

```ts
import { usufruct, signerExecutor } from '@usufruct-protocol/sdk';

const u = usufruct({ network: 'testnet', client, signer });    // signer = account + executor
// or read-only + external signing:
const u = usufruct({ network: 'testnet', client, account });   // .send() will require .send(executor)
```

### ① `send()` — the SDK drives (the 90%)

```ts
const cap     = await escrow.rent({ tenures: 1 }).send();
const amounts = await earningsInbox.collect().send();
await governanceCap.updateMarket(escrow, { restPrice: escrow.coin(0.02) }).send();
const { digest } = await cap.borrow((asset, tx) => {
  tx.transferObjects([tx.moveCall({ target: `${PKG}::asset::use`, arguments: [asset] })], BOB);
}).send();
```

### ② `send(executor)` — different signer, same rich result

```ts
const cap = await escrow.rent({ tenures: 1 }).send(walletExecutor);  // wallet / Ledger / sponsor
// → still returns a typed UsufructCap; only who signed changed
```

### ③ `u.batch(...)` — several writes in ONE atomic tx

```ts
const [a, b] = await u.batch(
  govA.updateMarket(eA, { restPrice: eA.coin(0.02) }),
  govB.updateMarket(eB, { restPrice: eB.coin(0.03) }),
).send();                                  // one .send(), one tx, all-or-nothing
```

### ④ `build()` — you drive (compose / mix raw commands)

```ts
import { Transaction } from '@mysten/sui/transactions';

const tx = new Transaction();
const ME = signer.toSuiAddress();

const rentPlan = escrow.rent({ tenures: 1 });
await rentPlan.build(tx, ME);                          // append
const fee = tx.splitCoins(tx.gas, [1_000])[0]!;        // raw Sui command, mid-PTB
tx.transferObjects([fee], TREASURY);
await cap.borrow(useAndKeepCoupon(BOB)).build(tx, ME); // the bracket nests too

const res    = await signerExecutor(client, signer).execute(tx);   // one execute
const rented = await rentPlan.decode(res);                          // decode if you want the handle
```

### ⑤ `toTransaction()` — build-only (wallet / offline)

```ts
const plan = escrow.rent({ tenures: 1 });
const tx   = await plan.toTransaction(ME);      // unsigned PTB
const res  = await wallet.signAndExecute(tx);   // signed/sent outside the SDK
const cap  = await plan.decode(res);            // you interpret the effects
```

### ⑥ Multi-tx — dependent writes (each its own `.send()`)

```ts
const cap = await escrow.rent({ tenures: 1 }).send();   // tx1
await sleep(handover);                                   // the cap isn't active yet
await cap.borrow(recipe).send();                         // tx2 — can't share tx1
```

### Reads — no `.send()`, for contrast

```ts
await escrow.market();        escrow.status;        await cap.state();
await earningsInbox.balance(); const e = await u.escrow(id);   // resolver, not a write
```

## Path 1 — `send()`: let the SDK drive (the 90%)

```ts
const cap     = await escrow.rent({ tenures: 1 }).send();
const amounts = await earningsInbox.collect().send();
await governanceCap.updateMarket(escrow, { restPrice: escrow.coin(0.02) }).send();

const { digest } = await cap.borrow((asset, tx) => {
  tx.transferObjects([tx.moveCall({ target: `${PKG}::asset::use`, arguments: [asset] })], BOB);
}).send();
```

One write, one transaction. `build`/`decode` stay hidden — you get the typed
result (`UsufructCap`, amounts, a digest). `.send()` uses the executor configured
on the session (`usufruct({ signer })`); pass one to override:

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

## Reads — for contrast

Reads never send and never carry `.send()`. They return data, eagerly. The `.send()`
on a write is exactly what tells write from read at a glance:

```ts
await escrow.market();        escrow.status;        await cap.state();
await earningsInbox.balance(); const e = await u.escrow(id);   // resolver, not a write
```

## Decision guide

| You want… | Path |
|---|---|
| One write, the SDK signs (keypair) | `await write().send()` |
| One write, a wallet / Ledger / sponsor signs | `await write().send(executor)` |
| One write, hand off the PTB (offline / external wallet) | `await write().toTransaction(me)` → decode after |
| Several independent writes, one atomic tx | `await u.batch(planA, planB).send()` |
| Same, with full control / raw commands / external wallet | `build()` each → `execute` once → `decode` each |
| Writes that depend on each other's chain result | separate `send()`s (multi-tx) |

## At a glance

```
write().send()              → SDK drives: build + sign + decode (one tx)
write().send(executor)      → SDK drives, YOU choose how it signs (wallet/Ledger/sponsor)
u.batch(a, b).send()        → SDK drives: many writes, ONE atomic tx, tuple of results
write().build(tx, me)       → YOU drive: append to your tx; you execute + decode
write().toTransaction(me)   → YOU drive: unsigned PTB; sign elsewhere, then decode
read()                      → never .send(); never touches the chain to write
```

## Enabling use cases — a multisig governor collecting earnings

A governor is often a **DAO or a multisig**, and `EarningsInbox.collect()` is the
write they run most. A multisig is just *how a transaction is signed* — the
`Executor` axis — so `collect()` never changes; only the executor does. Three
shapes the build/execute/decode split unlocks, from simplest to fully offline.

```ts
import { MultiSigPublicKey, MultiSigSigner } from '@mysten/sui/multisig';
import { usufruct, signerExecutor, type Executor, type ExecResult } from '@usufruct-protocol/sdk';

// the governor's 2-of-3 multisig (the address that holds the EarningsInbox)
const mpk = MultiSigPublicKey.fromPublicKeys({ threshold: 2, publicKeys: [
  { publicKey: pkA, weight: 1 }, { publicKey: pkB, weight: 1 }, { publicKey: pkC, weight: 1 },
]});
const INBOX = '0x…'; // the EarningsInbox object the multisig governs
```

### Case 1 — the multisig keys are on hand: it's just a `Signer`

`MultiSigSigner` implements `Signer`, so it drops into the `signer` slot
(`signer = account + executor`) and `collect()` is one line. **Multisig needs no
special handling** — that is the whole point.

```ts
const governor = new MultiSigSigner(mpk, [kpA, kpB]);          // 2 of 3 present → meets threshold
const u = usufruct({ network: 'testnet', client, signer: governor });

const earnings = await u.earningsInbox(INBOX).collect().send();
console.log(earnings);                                          // [{ coin, amount }] per coin (§5.2)
```

### Case 2 — co-signers are separate: a custom `Executor`

When the signers are different people/devices online at submit time, the multisig
is an `Executor` that gathers partial signatures and combines them. The session
holds only the identity; the executor is passed to `.send()`.

```ts
const multisigExecutor: Executor = {
  address: mpk.toSuiAddress(),                       // identity = the multisig address
  execute: async (tx): Promise<ExecResult> => {
    const bytes = await tx.build({ client });        // freeze the PTB
    const sigA = (await kpA.signTransaction(bytes)).signature;  // from co-signer A
    const sigB = (await kpB.signTransaction(bytes)).signature;  // from co-signer B
    const signature = mpk.combinePartialSignatures([sigA, sigB]);
    const res = await client.core.executeTransaction({
      transaction: bytes, signature, include: { effects: true, objectTypes: true },
    });
    await client.core.waitForTransaction({ digest: res.Transaction.digest });
    return res.Transaction;
  },
};

const u = usufruct({ network: 'testnet', client, account: mpk.toSuiAddress() }); // identity only
const earnings = await u.earningsInbox(INBOX).collect().send(multisigExecutor);
```

### Case 3 — build now, sign later (offline / asynchronous multisig)

The governance flow: propose the `collect` now, gather signatures over hours or
days across devices, then submit. `toTransaction()` gives the unsigned PTB; the
multisig signature binds to **those exact bytes**, so freeze once and distribute.

```ts
import { toBase64, fromBase64 } from '@mysten/sui/utils';

const u = usufruct({ network: 'testnet', client, account: mpk.toSuiAddress() });

// ① NOW — build and freeze; carry away the bytes
const plan  = u.earningsInbox(INBOX).collect();
const tx    = await plan.toTransaction(mpk.toSuiAddress());
const bytes = await tx.build({ client });
const b64   = toBase64(bytes);                          // the portable artifact → distribute

// ② LATER — each co-signer signs the SAME bytes, on their own device
const sigA = (await kpA.signTransaction(fromBase64(b64))).signature;  // today
const sigB = (await kpB.signTransaction(fromBase64(b64))).signature;  // tomorrow

// ③ WHEN ≥ threshold — combine and submit
const signature = mpk.combinePartialSignatures([sigA, sigB]);
const res = await client.core.executeTransaction({
  transaction: bytes, signature, include: { effects: true, objectTypes: true },
});
const earnings = await plan.decode(res.Transaction);   // typed result (keep `plan` to decode)
```

The three `Plan` phases spread **across time and machines**: `build` now (one
machine), `execute` later (partial signatures, combine, submit), `decode` at the
end. The write — `collect()` — is byte-for-byte the same in all three; only the
executor moved.

**Caveats (the chain is the arbiter).**
- A combined signature is valid only for the exact built `bytes` — freeze once,
  never rebuild before submitting.
- Gas coins are pinned at build; if spent before submit, the tx expires — rebuild
  and re-sign. "Sign later" has a freshness window.
- `decode` for `collect` needs the `plan` (it carries the messages discovered at
  build). From a fresh process, decode from effects yourself, or re-derive the sums.
- The exact pre-signed submit surface (`client.core.executeTransaction({ transaction,
  signature })`, `toBase64`/`fromBase64`) is `@mysten/sui` v2 API — confirm it when
  implementing; `signerExecutor` uses `signAndExecuteTransaction` for the held-key path.

## The principle

> A write is **build → execute → decode**. `send()` does all three (the common
> path); `build()` opens the middle so you can compose, batch, sponsor, or sign
> elsewhere. Nothing sends until you call `send()` (or run the tx yourself) — reads
> read, writes wait. The repetition of `.send()` is the price of that honesty, and
> it collapses to one call whenever you compose writes into a single transaction.

See [borrow composition](./borrow-composition.md) for the `Use`/`Plan.build`
bracket in depth, and [read · write · inspect · react](./read-write-inspect-react.md)
for where writes sit among the four verbs.
