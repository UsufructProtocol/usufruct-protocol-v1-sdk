# Probe C — multisig governor

**Primitive under test:** the `Executor` write seam.
**Question:** does it express *N-party* signing — a `GovernanceCap` held by a
multisig governing a rental market?

## What it does

The full **treasury loop** behind one M-of-N — govern *and* collect, all live:

1. Builds a **2-of-3 multisig** from three keypairs (in code — no hardware).
2. An operator lists an asset, then **transfers BOTH the `GovernanceCap` (to
   govern) and the `EarningsInbox` (to bank income) to the multisig** + funds gas.
3. **① Govern, synchronously** — `updateMarket` 0.01 → 0.02 DUMMY via a
   `multisigExecutor` (`.send()`), signed by two constituents combined.
4. **② Govern, distributed** — `updateMarket` 0.02 → 0.03 via `toTransaction` →
   each party signs apart → combine → `executeSigned` → `decode`.
5. **③ Earn** — a renter pays the 0.03 floor; the tenure elapses; the tenancy
   settles its earnings into the inbox.
6. **④ Collect** — the multisig collects the earnings (0.027 DUMMY = 90%, after
   the 10% protocol fee) — the defining treasury action, same seam.

## The finding ✅

The hypothesis held: a multisig is a **first-class `Executor` with zero core
changes**. The whole adapter is ~10 lines composing the SDK's exported
`executeSigned` with `@mysten/sui`'s `MultiSigPublicKey`:

```ts
function multisigExecutor(msPk, signers) {
  return {
    address: msPk.toSuiAddress(),
    execute: async (tx) => {
      tx.setSenderIfNotSet(msPk.toSuiAddress());
      const bytes = await tx.build({ client });
      const partials = await Promise.all(signers.map((s) => s.signTransaction(bytes).then((r) => r.signature)));
      return executeSigned(client, toBase64(bytes), [msPk.combinePartialSignatures(partials)]);
    },
  };
}

dao.connect(multisigExecutor(msPk, [a, b]));
await dao.governanceCap(capId).updateMarket(escrowId, { restPrice: DUMMY(0.02) }).send(); // just works
```

Same lesson as the browser wallet: **the SDK executes + enriches; only signing
is swapped.** A multisig is just "signing = N keypairs combined." `.send()`,
`batch()`, decode — all unchanged.

### Both forms run live (not just the synchronous one)

`multisigExecutor` works because every signer is **in-process**. A real DAO signs
**apart in time / on different machines** — and that works *asynchronously* too,
no new primitive: the build-only seam. The example runs **both** against testnet:

- **① synchronous** — `dao.connect(multisigExecutor(msPk, [a, b]))` → `.send()`. Floor 0.01 → 0.02.
- **② distributed/async** — build the bytes once, sign apart, combine, execute. Floor 0.02 → 0.03:

```ts
const plan  = dao.governanceCap(capId).updateMarket(escrowId, { restPrice: DUMMY(0.03) });
const tx    = await plan.toTransaction(msAddr);
const bytes = await tx.build({ client });           // ← serializable; hand around out-of-band

const sigA = (await a.signTransaction(bytes)).signature;   // party A, now
//  … bytes + sigA sit in a DB / travel the wire; NO live process between signers …
const sigB = (await b.signTransaction(bytes)).signature;   // party B, later, elsewhere

const combined = msPk.combinePartialSignatures([sigA, sigB]);   // anyone assembles
const res      = await executeSigned(client, toBase64(bytes), [combined]); // …and submits
const result   = await plan.decode(res);            // typed result, same as `.send()`
```

What crosses the wire between parties is **two strings** (the bytes + each
signature) — no open connection, no process waiting. So the answer to "can it be
async?" is **yes**: synchronous → `Executor`; asynchronous/distributed →
`toTransaction` + manual combine. Both expressible today; the seam is complete.
(Whether to *sugar* the distributed flow into a "partial-signing session" helper
is an ergonomics call, not a gap.)

## The most natural multisig action: collecting earnings

This probe drives `updateMarket` because it's a clean, verifiable governance
write. But the scenario a multisig *really* models is a **DAO treasury**, and a
treasury's defining action over a rental market is **banking its income** —
`earningsInbox.collect()`.

It's the same seam, no changes. The `EarningsInbox` is the governor's income
mailbox and its authority **is possession** — an inbox owned by the multisig is
collected by the multisig signing. So once the inbox is held by the multisig
(transfer it just like the `GovernanceCap`), collection is one line:

```ts
// synchronous — same multisigExecutor
dao.connect(multisigExecutor(msPk, [a, b]));
const earned = await dao.earningsInbox(inboxId).collect().send();   // signed by the multisig

// distributed — identical to ② above, just a different Plan
const plan  = dao.earningsInbox(inboxId).collect();
const tx    = await plan.toTransaction(msAddr);
const bytes = await tx.build({ client });
const combined = msPk.combinePartialSignatures([
  (await a.signTransaction(bytes)).signature,
  (await b.signTransaction(bytes)).signature,
]);
const earned = await plan.decode(await executeSigned(client, toBase64(bytes), [combined]));
```

That's the full treasury loop behind one M-of-N: **govern** the market
(`updateMarket`, `retire`) *and* **collect** its earnings (`collect`) — every
write, the same `Executor`/`Plan` seam. (`collect` is coin-polymorphic: it emits
one call per coin type, so a multi-coin inbox yields one `Plan` per `C` — see
`SPEC.md §5.2`. Each still flows through the seam unchanged.)

> **This runs live** as steps ③–④ of `index.ts`: the example transfers the
> `EarningsInbox` to the multisig, a renter pays, the tenancy settles, and the
> multisig collects 0.027 DUMMY. The loop is closed end-to-end on testnet.

## Run it

From the monorepo root (build the SDK first: `npm install && npm run build`):

```bash
npx tsx examples/multisig-governor/index.ts
```

Needs a funded testnet signer for the operator: `SUI_PRIVATE_KEY` env, or the
`usufruct-sdk-testnet` CLI alias. Testnet only.
