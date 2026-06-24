# FAQ — what the SDK does that intuition gets wrong

> The questions where DeFi habits lead to a failing tx or a wrong assumption,
> answered at the SDK level. For the deep protocol economics (escalation math,
> descent, per-tenure normalization), see the protocol repo's guide:
> <https://github.com/UsufructProtocol/usufruct-protocol-v1> → `llms.txt`.

**How do I get a funded signer / an asset / a coin to test with?**
See [testnet bootstrap](./testnet-bootstrap.md). Short version: ephemeral keypair →
fund via the web faucet (the programmatic one is rate-limited) → re-run. Price test
escrows in `SUI` so the faucet covers everything.

**Why did my read not change after the tenure expired?**
Usufruct is **lazy** — nothing settles until a transaction touches the escrow. Reads
show *real chain state*, not a computed projection: after a tenure lapses but before
anyone acts, `read.activeUsufructCapId()` still returns the sitting cap. Materialize
the transition with `escrow.write.applyPendingTransitionStates().send()` (or any
write). The time-parameterised views (`floorPrice(at)`, `accruedCredit(at)`) *do*
compute at `t` — but object state only moves when a tx moves it.

**Do I pay the floor once for N tenures?**
No — the floor is **per tenure**. `rent({ tenures: N })` auto-sources `floor × N`, so
let it. If you pass `pay` explicitly, send `floor × N` — sending one floor for `N > 1`
underpays and aborts (`InsufficientPayment`). Read the live floor first
(`await escrow.read.floorPrice()`) and derive with `Price` arithmetic (`.scale`/`.plus`).

**Does renting an idle escrow pay an escalated price?**
No. Escalation is **per-displacement**, not per-cycle — it only gates a bid that
displaces a sitting tenant. Renting an `idle` (or `descent`) escrow pays the floor (or
the current descending price), no escalation.

**I rented but `borrow` won't run — why?**
You probably challenged an **occupied** escrow, so your cap is `pending` (the
challenger seat), not `active`. You get the seat only after the handover window —
`borrow` can't run until then, and it's a separate transaction. Renting an **idle**
escrow seats you `active` immediately. Check with `await cap.read.state()` → `.status`.

**Why does `collect()` sometimes do more than one transaction?**
An inbox is **coin-polymorphic**, so `collect` partitions messages by coin type and
emits **one PTB per coin** — a mismatched `Receiving<T>` would abort inside
`0x2::transfer::receive_impl`. You get back one `{ coin, amount }` per coin collected.

**`inspect.*` throws — what's wrong?**
`inspect.*` (history, discovery, ledgers) needs a **GraphQL** endpoint. It defaults
from the network; you only see this if you passed `graphql: false`. `read`/`write`/
`react` don't need it.

**How do I price in my own coin (not SUI)?**
The coin is fixed at `integrate` (a `phantom CoinType`, immutable). Build the tag with
`await u.coinType('0x…')` (fetches decimals/symbol) or `coinTag({ type, decimals,
symbol })` (synchronous), and pass it as `coin`. A governor's portfolio can hold
escrows of different coins all paying one inbox.

**Where did my cap/asset go after `rent`/`claim`/`integrate`?**
To **you** (the sender) by default — the SDK appends the transfer. Pass `to` to send
it elsewhere atomically: `rent({ …, to })`, `claim(escrow, { to })`,
`integrate({ …, to: { governanceCap, earningsInbox } })`. The Move calls return the
object by value; "it lands in my wallet" is the SDK's default, not protocol behaviour.

**How is authority decided — is there a login/role?**
No. Authority is **possession** of a bearer object (`key + store`). Holding the
`GovernanceCap` makes you the governor; holding the `UsufructCap` makes you the
usufructuary. `transfer` moves the object → moves the role. Ask the canonical views
(`isRetired`, `cap.read.isActive()`, `u.inspect.governedBy(me)`), not a `role()`.

**Can I do several writes in one transaction?**
Independent writes: yes — `u.batch(a, b).send()` (one atomic tx) or `plan.build(tx,
sender)` to drive the PTB yourself. **Dependent** writes (rent → wait the handover →
borrow) need separate transactions — that's the protocol, not the SDK.

**Should I trust a read I cached?**
Reads are **live and lazy** — there's no fetch-time photo; each `read.*` hits the
chain when called. For a coherent cross-section at one instant, take
`escrow.read.snapshot()`. Don't hold a value across a write and assume it still holds.
