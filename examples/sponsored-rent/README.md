# Probe D — sponsored rent (gas station)

**Primitive under test:** the `Executor` write seam.
**Question:** does it express **sender ≠ gas payer** — a user with no SUI
transacting while a sponsor pays the gas?

## What it does

1. The operator lists an asset as a DUMMY-priced market.
2. A **brand-new user** is funded with **DUMMY only — no SUI**, so it cannot pay
   its own gas (verified: it owns 0 SUI coins).
3. The gasless user **rents** via a `sponsoredExecutor`: the user is the sender
   and pays the rent (in DUMMY) and authorizes the action; the **sponsor pays the
   gas**. The transaction carries two signatures.
4. Proof: after the rent, the user **still owns 0 SUI coins** — every bit of gas
   came from the sponsor — and the `UsufructCap` is the user's.

## The finding ✅

It fits the **existing seam with zero core changes**. A gas station is a ~12-line
`Executor` whose `execute` sets the gas owner to the sponsor and gathers both
signatures, then submits via the SDK's exported `executeSigned`:

```ts
function sponsoredExecutor(user, sponsor) {
  return {
    address: user.toSuiAddress(),              // identity = the user (the sender)
    execute: async (tx) => {
      tx.setSenderIfNotSet(user.toSuiAddress());
      tx.setGasOwner(sponsor.toSuiAddress());   // ← gas comes from the sponsor
      const bytes = await tx.build({ client }); // gas payment auto-resolves from the gas owner
      const userSig = (await user.signTransaction(bytes)).signature;     // authorizes
      const sponsorSig = (await sponsor.signTransaction(bytes)).signature; // pays gas
      return executeSigned(client, toBase64(bytes), [userSig, sponsorSig]);
    },
  };
}

u.connect(sponsoredExecutor(user, sponsor));
await (await u.escrow(escrowId)).rent({ tenures: 1 }).send(); // the user pays no gas
```

Same lesson as the wallet/multisig probes: **the SDK executes + enriches; only the
*signing arrangement* changes.** Sponsorship is just "two signers: the sender
authorizes, the gas owner pays."

### A prediction that reality softened

Going in, I expected friction in **gas-coin selection** — that the executor would
have to query the sponsor's SUI coins and call `setGasPayment(...)` explicitly.
It didn't: `setGasOwner(sponsor)` + `tx.build({ client })` **auto-resolves** the
gas payment from the gas owner. So the adapter is even smaller than predicted —
set the gas owner, gather two signatures, done. (If you ever need to pin exact
gas coins — e.g. a busy sponsor avoiding equivocation — `setGasPayment(refs)` is
there, but it is not required.)

### Distributed sponsorship (a real gas station is remote)

Here both signers are in-process. A production gas station is an **HTTP service**:
the user builds + signs the bytes, sends them to the service, the service signs
with its gas and returns the sponsor signature. That is the same build-only seam
as the multisig probe — `toTransaction` → build bytes → user signs → (ship bytes
to the sponsor service) → sponsor signs → `combine? no — [userSig, sponsorSig]` →
`executeSigned` → `decode`. What crosses the wire is the bytes + each signature.
No new primitive; the seam already supports it.

## Run it

From the monorepo root (build the SDK first: `npm install && npm run build`):

```bash
npx tsx examples/sponsored-rent/index.ts
```

Needs a funded testnet signer for the operator/sponsor: `SUI_PRIVATE_KEY` env, or
the `usufruct-sdk-testnet` CLI alias. Testnet only.
