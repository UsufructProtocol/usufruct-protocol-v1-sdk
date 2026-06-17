/**
 * Read-batching benchmark — counts network round-trips per handle read.
 *
 * Wraps the client so every `client.core.simulateTransaction` / `getObject` /
 * `listOwnedObjects` is counted, then measures two hot reads:
 *   • `u.escrow(id)`   — resolving an (occupied) escrow handle
 *   • `cap.state()`    — resolving the active seat
 *
 * Run the SAME script before and after the batching refactor to compare. The
 * `simulateTransaction` count is the metric (each view read = one sim today).
 * `retry: false` so counts are logical reads, not retry inflation.
 *
 * Run: `npm run bench:reads`.
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
  listOwnedObjects: number;
}

/** A client whose `core` calls are counted by kind. */
function counting(client: ClientWithCoreApi): { client: ClientWithCoreApi; counts: Counts; reset: () => void } {
  const counts: Counts = { simulateTransaction: 0, getObject: 0, listOwnedObjects: 0 };
  const core = new Proxy(client.core as object, {
    get(target, prop, recv) {
      const orig = Reflect.get(target, prop, recv);
      if (typeof orig !== 'function') return orig;
      return (...args: unknown[]) => {
        if (prop === 'simulateTransaction') counts.simulateTransaction++;
        else if (prop === 'getObject') counts.getObject++;
        else if (prop === 'listOwnedObjects') counts.listOwnedObjects++;
        return (orig as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
  const wrapped = new Proxy(client, {
    get: (target, prop, recv) => (prop === 'core' ? core : Reflect.get(target, prop, recv)),
  });
  return {
    client: wrapped as ClientWithCoreApi,
    counts,
    reset: () => {
      counts.simulateTransaction = 0;
      counts.getObject = 0;
      counts.listOwnedObjects = 0;
    },
  };
}

const fmt = (c: Counts) =>
  `simulateTransaction=${c.simulateTransaction}  getObject=${c.getObject}  listOwnedObjects=${c.listOwnedObjects}`;

const ALICE = loadSigner();
const BOB = Ed25519Keypair.generate();

async function setup(setupClient: ClientWithCoreApi): Promise<{ escrowId: string; capId: string }> {
  // mint Alice an asset + fund Bob (gas + DUMMY)
  const tx = new Transaction();
  const sword = tx.moveCall({ target: `${DUMMY_PKG}::dummy_asset::mint` });
  tx.transferObjects([sword], ALICE.toSuiAddress());
  tx.transferObjects([tx.splitCoins(tx.gas, [120_000_000n])[0]!], BOB.toSuiAddress());
  tx.transferObjects(
    [tx.moveCall({ target: `${DUMMY_COIN_PKG}::dummy_coin::mint`, arguments: [tx.object(DUMMY_COIN_TREASURY), tx.pure.u64(1_000_000_000n)] })],
    BOB.toSuiAddress(),
  );
  const assetId = createdId(await send(setupClient, tx, ALICE), '::dummy_asset::DummyAsset');

  const alice = usufruct({ network: 'testnet', client: setupClient, signer: ALICE });
  const { escrow } = await alice
    .integrate({
      asset: assetId,
      coin: DUMMY,
      market: {
        restPrice: DUMMY(0.01),
        tenure: '120s',
        multiTenure: false,
        creditShape: 'linear',
        auctionShape: 'smoothstep',
        descent: '10s',
        handover: '5s',
        escalation: { fixed: DUMMY(0.001) },
        retireCommitment: 'immediate',
        ensembleCommitment: 'immediate',
      },
    })
    .send();

  // rent so the escrow is OCCUPIED and a cap is active (exercises both batches)
  const bob = usufruct({ network: 'testnet', client: setupClient, signer: BOB });
  const cap = await (await bob.escrow(escrow.id)).rent({ tenures: 1 }).send();
  return { escrowId: escrow.id, capId: cap.id };
}

async function main() {
  const { escrowId, capId } = await setup(rateLimited(makeClient()));

  // measured client: counted, retry OFF (logical reads only)
  const { client, counts, reset } = counting(makeClient());
  const bob = usufruct({ network: 'testnet', client, signer: BOB, retry: false });

  console.log('Read round-trips (lower is better):\n');

  reset();
  const escrow = await bob.escrow(escrowId);
  console.log(`u.escrow(id)   [status=${escrow.status}]  → ${fmt(counts)}`);

  const capH = await bob.usufructCap(capId);
  reset();
  const seat = await capH.state();
  console.log(`cap.state()    [role=${seat.role}]        → ${fmt(counts)}`);

  // spot-check a couple of values render (behavior must be unchanged across the refactor)
  console.log(`\nspot-check: escrow.floorPrice=${escrow.floorPrice}  seat.stake=${seat.stake ?? 'null'}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
