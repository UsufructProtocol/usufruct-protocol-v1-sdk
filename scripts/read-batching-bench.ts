/**
 * Cross-escrow read benchmark — round-trips to resolve M escrow handles.
 *
 * Counts client.core.simulateTransaction / getObject / getObjects /
 * listOwnedObjects, then resolves the SAME M escrows two ways:
 *   • loop:     for (id of ids) await u.escrow(id)   — one set of reads per escrow
 *   • batched:  await u.escrows(ids)                 — interleaved, deduped
 *
 * `retry: false` so counts are logical reads. Run: `npm run bench:reads`.
 */
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import type { ClientWithCoreApi } from '@mysten/sui/client';
import { coinTag, usufruct } from '@usufruct-protocol/sdk';
import { createdId, loadSigner, makeClient, rateLimited, send } from './lib.js';

const DUMMY_PKG = '0xa72e830fcb3e688ab3c20ff3cbd0a149cd1b58715709905585e75eb18317a52a';
const DUMMY_COIN_PKG = '0x97fb7c77162e3edf6a44815ec9eb29b69f9a43747dfb1c1019a7fc5501e2ad96';
const DUMMY_COIN_TREASURY =
  '0xccee2bc2227913f441c7544892cf5d220880cbc0c55be8733b4b6777def976bc';
const DUMMY = coinTag({ type: `${DUMMY_COIN_PKG}::dummy_coin::DUMMY_COIN`, decimals: 9, symbol: 'DUMMY' });

interface Counts {
  simulateTransaction: number;
  getObject: number;
  getObjects: number;
  listOwnedObjects: number;
}
const zero = (): Counts => ({ simulateTransaction: 0, getObject: 0, getObjects: 0, listOwnedObjects: 0 });

/** A client whose `core` calls are counted by kind. */
function counting(client: ClientWithCoreApi): { client: ClientWithCoreApi; counts: Counts; reset: () => void } {
  const counts = zero();
  const core = new Proxy(client.core as object, {
    get(target, prop, recv) {
      const orig = Reflect.get(target, prop, recv);
      if (typeof orig !== 'function') return orig;
      return (...args: unknown[]) => {
        if (prop in counts) (counts as Record<string, number>)[prop as string]++;
        return (orig as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
  const wrapped = new Proxy(client, {
    get: (target, prop, recv) => (prop === 'core' ? core : Reflect.get(target, prop, recv)),
  });
  return { client: wrapped as ClientWithCoreApi, counts, reset: () => Object.assign(counts, zero()) };
}

const fmt = (c: Counts) =>
  `simulateTransaction=${c.simulateTransaction}  getObject=${c.getObject}  getObjects=${c.getObjects}  listOwnedObjects=${c.listOwnedObjects}`;

const ALICE = loadSigner();
const BOB = Ed25519Keypair.generate();
const MARKET = {
  restPrice: DUMMY(0.01),
  tenure: '180s',
  multiTenure: false,
  creditShape: 'linear',
  auctionShape: 'smoothstep',
  descent: '10s',
  handover: '5s',
  escalation: { fixed: DUMMY(0.001) },
  retireCommitment: 'immediate',
  ensembleCommitment: 'immediate',
} as const;

const N = 3;

async function setup(c: ClientWithCoreApi): Promise<string[]> {
  // mint Alice N assets + fund Bob (gas + DUMMY)
  const tx = new Transaction();
  const assets = Array.from({ length: N }, () => tx.moveCall({ target: `${DUMMY_PKG}::dummy_asset::mint` }));
  tx.transferObjects(assets, ALICE.toSuiAddress());
  tx.transferObjects([tx.splitCoins(tx.gas, [50_000_000n])[0]!], BOB.toSuiAddress());
  tx.transferObjects(
    [tx.moveCall({ target: `${DUMMY_COIN_PKG}::dummy_coin::mint`, arguments: [tx.object(DUMMY_COIN_TREASURY), tx.pure.u64(1_000_000_000n)] })],
    BOB.toSuiAddress(),
  );
  const res = await send(c, tx, ALICE);
  const assetIds = res
    .effects!.changedObjects!.filter(
      (o) => o.idOperation === 'Created' && res.objectTypes?.[o.objectId]?.includes('::dummy_asset::DummyAsset'),
    )
    .map((o) => o.objectId);

  const alice = usufruct({ network: 'testnet', client: c, signer: ALICE });
  const ids: string[] = [];
  for (const asset of assetIds) {
    const { escrow } = await alice.write.integrate({ asset, coin: DUMMY, market: MARKET }).send();
    ids.push(escrow.id);
  }
  // rent the FIRST so the set is mixed: 1 occupied + (N-1) idle.
  const bob = usufruct({ network: 'testnet', client: c, signer: BOB });
  await (await bob.nav.escrow(ids[0]!)).write.rent({ tenures: 1 }).send();
  return ids;
}

async function main() {
  const ids = await setup(rateLimited(makeClient()));

  const { client, counts, reset } = counting(makeClient());
  const bob = usufruct({ network: 'testnet', client, signer: BOB, retry: false });

  console.log(`Resolving ${ids.length} escrows (1 occupied, ${ids.length - 1} idle) — round-trips, lower is better:\n`);

  reset();
  const loop = [];
  for (const id of ids) loop.push(await bob.nav.escrow(id));
  console.log(`loop  for(id) u.nav.escrow(id)  → ${fmt(counts)}`);

  reset();
  const batched = await bob.nav.escrows(ids);
  console.log(`batch u.nav.escrows(ids)        → ${fmt(counts)}`);

  // spot-check: the two paths resolve identical fields per escrow.
  const same = (
    await Promise.all(
      ids.map(async (_, i) => {
        const a = loop[i]!;
        const b = batched[i]!;
        const [aState, bState] = [await a.read.assetState(), await b.read.assetState()];
        const [aFloor, bFloor] = [await a.read.floorPrice(), await b.read.floorPrice()];
        const [aCap, bCap] = [await a.read.activeUsufructCapId(), await b.read.activeUsufructCapId()];
        const [aRole, bRole] = [await a.read.role(), await b.read.role()];
        return aState.kind === bState.kind && `${aFloor}` === `${bFloor}` && aCap === bCap && aRole.canBorrow === bRole.canBorrow;
      }),
    )
  ).every(Boolean);
  console.log(`\nspot-check (status/floor/activeCap/canBorrow match loop↔batch): ${same ? 'OK ✓' : 'MISMATCH ✗'}`);
  console.log(`statuses: ${(await Promise.all(batched.map(async (e) => (await e.read.assetState()).kind))).join(', ')}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
