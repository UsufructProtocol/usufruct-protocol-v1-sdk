# Cookbook — complete, runnable recipes

> Dry, self-contained recipes for the common tasks — copy one and adapt. Each is
> distilled from a testnet-validated script in [`scripts/`](../scripts), with the
> test scaffolding (ephemeral funding, asserts) stripped. Every recipe assumes the
> **setup block** below; all chain calls are `async`.

```ts
import { usufruct, SUI } from '@usufruct-protocol/sdk';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

// signer = identity + signing. Swap for { account } (read-only) or { executor }
// (wallet/Ledger/sponsor/multisig). network picks the RPC + GraphQL endpoints.
const u = usufruct({ network: 'testnet', signer: Ed25519Keypair.generate() });
const me = u.address!;                       // your address (identity)
```

## 1. Connect and read state

```ts
const escrow = await u.nav.escrow('0xESCROW');     // resolve a handle (identity only, no fetch-time photo)

const state = await escrow.read.assetState();      // a discriminated union — narrows per phase
switch (state.kind) {
  case 'idle':     state.floor; break;                                  // rentable at the floor
  case 'occupied': state.usufructuary; state.stake; state.expiresAt; break;
  case 'demand':   state.challenger; state.bid; state.handoverExpiresAt; break;
  case 'descent':  state.from; state.floor; state.expiresAt; break;     // Dutch auction
  case 'retired':  break;
}

const floor  = await escrow.read.floorPrice();     // a Price, in the escrow's own coin
const market = await escrow.read.market();          // the full mutable policy
console.log(floor.format(), market.tenure);
```

## 2. List an asset (integrate) and read it back

```ts
// `coin` is the escrow's immutable payment coin (a CoinTag). For a non-SUI coin:
//   const USDC = await u.coinType('0x…::usdc::USDC');
const { escrow, governanceCap, earningsInbox } = await u.write.integrate({
  asset: '0xASSET',                 // an owned object id (key + store)
  coin: SUI,
  market: {
    restPrice: SUI(0.01),           // floor when idle
    tenure: '1h',                   // Duration: ms/s/m/h/d, or a number of ms
    multiTenure: true,
    creditShape: 'linear',
    auctionShape: 'linear',
    descent: 'off',                 // or a Duration for a Dutch auction
    handover: '5m',                 // 'off' | 'fullTenure' | Duration
    escalation: { fixed: SUI(0.001) },
    retireCommitment: 'immediate',  // or { deferredFor: '7d' }
    ensembleCommitment: 'immediate',
  },
}).send();

console.log(escrow.id, governanceCap.capId, earningsInbox.inboxId);
console.log((await escrow.read.assetState()).kind);   // 'idle'
// the three handles are independent bearer objects — move any of them.
```

## 3. Rent and use the asset (borrow)

```ts
const escrow = await u.nav.escrow('0xESCROW');
const cap = await escrow.write.rent({ tenures: 1 }).send();   // pays the floor; `pay` to overpay → stake
// rent on behalf of a buyer (cap lands with them, you pay): rent({ tenures: 1, to: '0xBUYER' })

console.log((await cap.read.state()).status);    // 'active' | 'pending' | 'stale'

// borrow hands you the asset mid-PTB; the return is appended for you, guaranteed.
// External calls must take the asset BY REFERENCE (&Asset / &mut Asset).
const PKG = '0xGAME';
await cap.write.borrow((asset, tx) => {
  const coupon = tx.moveCall({ target: `${PKG}::game::play`, arguments: [asset] }); // &mut Asset
  tx.transferObjects([coupon], me);              // keep any artifact it produced
}).send();

// compose several recipes in order, one atomic PTB:
// await cap.write.borrow(inspect, play(me), play(me)).send();
```

## 4. Govern a market (update / retire / claim)

```ts
const gov    = await u.nav.governanceCap('0xGOVCAP');   // authority = holding this cap
const escrow = '0xESCROW';                              // EscrowRef: an id or an Escrow handle

await gov.write.updateMarket(escrow, { restPrice: SUI(0.02) }).send();   // change the policy
await gov.write.retire(escrow).send();                                   // stop renting (commitment permitting)
const { assetId } = await gov.write.claim(escrow).send();                // pull the asset back out → you
// claim straight to someone else: gov.write.claim(escrow, { to: '0xRECIPIENT' })

// the portfolio this cap governs:
const mine = await gov.inspect.escrows();               // EscrowListing[] (needs graphql)
```

## 5. Collect earnings (partitioned by coin)

```ts
const inbox = await u.nav.earningsInbox('0xINBOX');     // or escrow.nav.earningsInbox()

const pending = await inbox.read.balance();             // [{ coin, amount: Price }] uncollected, per coin
const collected = await inbox.write.collect().send();   // collect ALL coins (one PTB per coin type, §5.2)

for (const { coin, amount } of collected) console.log(coin, amount.format());
// the ProtocolFeeInbox is the same shape: const fee = await u.nav.feeInbox();
```

## 6. Discover and react (no polling)

```ts
const governed = await u.inspect.governedBy(me);        // escrows I govern NOW (follows the cap)
const rented   = await u.inspect.rentedBy(me);          // escrows I rent
const byCoin   = await u.inspect.byCoinType(SUI.type);  // every escrow priced in SUI

const escrow = await u.nav.escrow('0xESCROW');

// continuous: fresh handle on every on-chain change
const stop = escrow.react.watch(e => render(e));
// one-shot: resolve the moment a challenge starts, then act on the handle
const inDemand = await escrow.react.waitFor(async e => (await e.read.assetState()).kind === 'demand');
await inDemand.write.applyPendingTransitionStates().send();
// typed events: escrow.react.on('BidPlaced', ev => counterBid(ev.data));
stop();
```

## 7. Drive the transaction yourself (Plan: build / batch)

```ts
// Every write is a Plan: .send() does build+sign+decode. Reach for build/batch when
// you need one atomic tx across several writes, or to mix raw Sui commands.
import { Transaction } from '@mysten/sui/transactions';
import { signerExecutor } from '@usufruct-protocol/sdk';

// (a) ergonomic — several independent writes, one atomic tx:
const [a, b] = await u.batch(
  govA.write.updateMarket(eA, { restPrice: SUI(0.02) }),
  govB.write.updateMarket(eB, { restPrice: SUI(0.03) }),
).send();

// (b) full control — append to your own PTB, mix raw commands, execute once:
const tx = new Transaction();
const rentPlan = escrow.write.rent({ tenures: 1 });
await rentPlan.build(tx, me);
tx.transferObjects([tx.splitCoins(tx.gas, [1_000])[0]!], '0xTREASURY');  // raw command, mid-PTB
const res = await signerExecutor(/* client */ undefined as any, signer).execute(tx);
const cap = await rentPlan.decode(res);
```

> Pitfalls: `inspect.*` needs `graphql` (on by default); `collect` is one PTB per
> coin type; `borrow` middles take the asset by reference; dependent writes (rent →
> wait handover → borrow) need separate txs; reads are live and lazy (no fetch-time
> photo). See [api design](./api-design.md), [write model](./write-model.md),
> [borrow](./borrow.md), and the [API reference](../API.md).
