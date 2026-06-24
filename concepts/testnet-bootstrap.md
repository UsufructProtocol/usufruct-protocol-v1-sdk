# Testnet bootstrap — a funded signer, an asset, a coin

> Before any script runs you need three things: a **funded signer**, an **asset** to
> list, and the **coin** rent is priced in. This is the zero-to-running path on Sui
> testnet. (For *what Usufruct is* and the protocol economics, see the protocol
> repo's agent guide: <https://github.com/UsufructProtocol/usufruct-protocol-v1> →
> `llms.txt`. This doc is the SDK how-to.)

## ⛔ The one rule — testnet only

Every example here is **Sui testnet**, faucet SUI, zero real value. Default to a
**fresh, ephemeral keypair** — never load a user's existing mainnet keys to sign
SDK writes. If a dev wants to act as themselves, take their **address** (`account`,
identity only) and let their wallet sign (`executor`); the SDK never needs private
keys.

## 1. A funded signer

A generated keypair starts empty. The programmatic faucet is heavily rate-limited
and usually refuses — so **print the address + the faucet link, let the dev fund it
in the browser, then re-run**:

```ts
import { usufruct } from '@usufruct-protocol/sdk';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { getFaucetHost, requestSuiFromFaucetV2 } from '@mysten/sui/faucet';

const signer = Ed25519Keypair.generate();           // ephemeral — persist the secret if you want to reuse it
const me = signer.toSuiAddress();

await requestSuiFromFaucetV2({ host: getFaucetHost('testnet'), recipient: me }).catch(() => {});
console.log(`Fund this address, then re-run:\n  https://faucet.sui.io/?network=testnet&address=${me}`);

const u = usufruct({ network: 'testnet', signer });  // ready once the address has SUI for gas
```

To **reuse** a funded address across runs, persist the secret key
(`signer.getSecretKey()`) and rebuild with `Ed25519Keypair.fromSecretKey(...)`, or
load the Sui CLI keystore — anything that yields a `Signer`/`Ed25519Keypair`.

## 2. An asset and a coin — usufruct is doubly generic

`Escrow<Asset, CoinType>` is **agnostic to both**: *any* `key + store` object can be
listed, priced in *any* `Coin<C>`. The test defaults below are just zero-friction —
the faucet hands out SUI, and the dummy asset/coin publish freely. **Neither is
privileged.** If the dev owns a `key + store` object on testnet, list *that*; if they
have their own coin, price in *that*.

```ts
import { SUI, coinTag } from '@usufruct-protocol/sdk';
import { Transaction } from '@mysten/sui/transactions';

// Coin: SUI is the zero-friction default (the faucet funds it directly). For another
// coin, resolve metadata on-chain (await u.coinType('0x…')) or build the tag synchronously.
const DUMMY_COIN = coinTag({
  type: '0x97fb7c77162e3edf6a44815ec9eb29b69f9a43747dfb1c1019a7fc5501e2ad96::dummy_coin::DUMMY_COIN',
  decimals: 9, symbol: 'DUMMY',
});

// Asset: mint a free test asset to get an object id to list. Replace with any
// key+store object the dev already owns.
const DUMMY_ASSET_PKG = '0xa72e830fcb3e688ab3c20ff3cbd0a149cd1b58715709905585e75eb18317a52a';
async function mintTestAsset(client, signer): Promise<string> {
  const tx = new Transaction();
  tx.transferObjects([tx.moveCall({ target: `${DUMMY_ASSET_PKG}::dummy_asset::mint` })], me);
  const res = await client.signAndExecuteTransaction({ transaction: tx, signer, options: { showEffects: true } });
  // the created DummyAsset's id is in the effects (the one object of type ::dummy_asset::DummyAsset)
  return /* createdObjectId(res, '::dummy_asset::DummyAsset') */ '0x…';
}
```

> **Price test escrows in `SUI`** when you can — the faucet funds it directly, so a
> renter needs no extra step. Pricing in `DUMMY` (or any non-faucet coin) means the
> renter must also hold that coin (the dummy coin has a public `mint`).

## 3. Now you're ready

With a funded `signer`, an `assetId`, and a `coin`, the rest is the
[cookbook](./cookbook.md): `integrate` the asset → `rent` it → `borrow` to use it →
`collect` earnings. The [api design](./api-design.md) is the model;
[`API.md`](../API.md) is the full surface.

```ts
const { escrow } = await u.write.integrate({ asset: assetId, coin: SUI, market: { /* … */ } }).send();
const cap = await escrow.write.rent({ tenures: 1 }).send();
await cap.write.borrow((asset, tx) => { /* use the asset */ }).send();
```
