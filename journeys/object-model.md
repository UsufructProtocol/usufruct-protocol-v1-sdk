# The object model — possession is the role

> The high-level API is **object-centric, not role-centric.** A "governor",
> "usufructuary", "earnings collector" is not an identity the SDK tracks — it is
> *whoever currently holds the corresponding object*. The objects move; the roles
> move with them.

## The principle

The protocol has four capability objects, all `key + store` (verified in source):

| Object | `has` | Created at | Initial holder |
|---|---|---|---|
| `GovernanceCap` | `key, store` (`governance_cap.move:17`) | `integrate` | the integrator |
| `EarningsInbox` | `key, store` (`earnings_inbox.move:14`) | `integrate` | the integrator |
| `UsufructCap` | `key, store` (`usufruct_cap.move:17`) | `rent` | the renter |
| `ProtocolFeeInbox` | `key, store` (`protocol_fee_inbox.move:16`) | deploy (`public_transfer` to sender) | the deployer |

`store` means anyone can `public_transfer` them. And Move makes the authority
**possession itself**: to produce a `&GovernanceCap`, `&mut EarningsInbox`, or
`&UsufructCap` inside a PTB you must pass `tx.object(id)` — which only succeeds if
the *signer owns it*. So:

- Holding the `GovernanceCap` makes you the **governor** — not necessarily the
  address that called `integrate`.
- Holding the `EarningsInbox` lets you **collect earnings** — maybe a treasury
  address, not the governor.
- Holding the `UsufructCap` makes you the **usufructuary** — not necessarily the
  address that called `rent` (the right of use is a tradable bearer instrument).
- Holding the `ProtocolFeeInbox` lets you **collect fees** — the deployer, or
  whoever they hand it to.

**The role is emergent from possession.** Modelling a "Governor" that *owns* its
cap and inbox is backwards — and it lies exactly where it matters: selling the
governance of a market, pointing earnings at a treasury, a secondary market for
rights of use, an integrator handing everything off.

## The handle taxonomy — one handle per capability object

Names are **explicit about the object** — never a bare `cap`/`earnings` (which
cap? whose earnings?):

| Object | Handle | Writes (authority = holding it) | Door |
|---|---|---|---|
| `Escrow` (shared) | `Escrow` | `rent`, `apply` (permissionless) + reads | `u.escrow(id)` |
| `UsufructCap` | `UsufructCap` | `borrow`/`.into`, `updateRefundAddress`, `burnIfStale`, `burn`, **`transfer`** | `u.usufructCap(id)` |
| `GovernanceCap` | `GovernanceCap` | `update`/`retire`/`claim`/`extend*`, `renounce`, `list`, **`transfer`** | `u.governanceCap(id)` |
| `EarningsInbox` | `EarningsInbox` | `balance`, `collect`, **`transfer`** | `u.earningsInbox(id)` |
| `ProtocolFeeInbox` | `ProtocolFeeInbox` | `balance`, `collect`, **`transfer`** | `u.feeInbox(id)` |

There is **no `Governor`** handle. `integrate` mints three objects and returns
three independent handles:

```ts
const { escrow, governanceCap, earningsInbox } = await u.integrate({ asset, market });
// each is a separate bearer object; they can diverge from here.
```

The per-escrow governance writes name their target escrow (one cap governs a
portfolio): `governanceCap.update(escrow, market)`. Listing a new escrow under a
cap also names the inbox it pays into — because the two are separable:

```ts
await governanceCap.list(asset, market, { earningsInbox: earningsInbox.inboxId });
```

## `transfer` is first-class — moving the object moves the role

Every bearer handle has `transfer(to)` (`tx.transferObjects([tx.object(id)], to)`,
signed by the current holder). This is the whole point, not an afterthought:

```ts
await governanceCap.transfer(treasury);   // hand off governance
await earningsInbox.transfer(treasury);   // route income elsewhere
await usufructCap.transfer(buyer);        // sell the right of use
```

After the transfer, the new holder governs/collects/uses; the old holder's
handle no longer works (the chain rejects a `tx.object(id)` it doesn't own →
`NotGovernor` / not-owned).

## The Escrow: identities (data) vs holdings (what *I* hold)

The escrow knows, as plain data, **which objects relate to it** — regardless of
who holds them:

```ts
escrow.governanceCapId;     // the cap that governs this escrow
escrow.earningsInboxId;     // the inbox it pays into
escrow.feeInboxId;          // the protocol fee inbox
escrow.activeUsufructCapId; // the current right-of-use cap (or null)
```

Separately, it resolves **which of those the signer currently holds**, as ready
handles (else `null`):

```ts
escrow.usufructCap;   // UsufructCap   — if I hold the active cap
escrow.governanceCap; // GovernanceCap — if I hold the gov cap
escrow.earningsInbox; // EarningsInbox — if I hold the earnings inbox
escrow.canRent / escrow.canBorrow / escrow.canGovern; // sugar over "do I hold X here?"
```

This keeps the UI ergonomics ("what can *I* do here?") while being honest that
the answer is *possession*, resolved by an owned-objects lookup, not an identity
the SDK assumes.

## Why this is the full expression of "resolve, don't hide" (rule #5)

Rule #5: only the global singletons (`Clock`, `ProtocolFeeRef`) are injected;
every owned object stays explicit, as the **receiver** of its call. The
object-centric model is that rule taken to its conclusion: the owned object *is*
the handle, and possession *is* the authority. The old `Governor` bundle was a
residual role-centric assumption (one entity owns cap + inbox) that snuck back in
— this removes it. The kernel was object-centric all along (the Move fns take the
objects independently); only Layer 2 had bundled them.
