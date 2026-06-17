/**
 * Writes as deferred plans — the multi-tx flow, end to end on testnet.
 *
 * `escrow.rent(...)` now returns a `Plan<UsufructCap>`: build → execute → decode,
 * with execution delegated. This script proves three things:
 *
 *   A  MULTI-TX     — tx1 `rent().send()` yields a real cap (id + receipt decoded
 *                     from effects); tx2 `cap.borrow(...)` uses that real on-chain
 *                     id. The result of tx1 flows into tx2.
 *   B  THE SEAM     — `rent().send(customExecutor)` signs through a hand-rolled
 *                     executor (a stand-in for wallet / Ledger / sponsor) and the
 *                     rich `UsufructCap` STILL decodes. Signing is swappable.
 *   C  BUILD-ONLY   — `rent().toTransaction(addr)` hands back an unsigned PTB
 *                     (for offline / batching) without executing anything.
 *
 * Run: `npm run demo:multitx`.
 */
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { coinTag, usufruct, type Executor } from '@usufruct-protocol/sdk';
import { createdId, loadSigner, makeClient, rateLimited, send } from './lib.js';
import { DUMMY_PKG, inspectAsset, useAndKeepCoupon } from './recipes/dummy-asset.js';

const DUMMY_COIN_PKG = '0x97fb7c77162e3edf6a44815ec9eb29b69f9a43747dfb1c1019a7fc5501e2ad96';
const DUMMY_COIN_TREASURY =
  '0xccee2bc2227913f441c7544892cf5d220880cbc0c55be8733b4b6777def976bc';
const DUMMY = coinTag({ type: `${DUMMY_COIN_PKG}::dummy_coin::DUMMY_COIN`, decimals: 9, symbol: 'DUMMY' });

const client = rateLimited(makeClient());
const ALICE = loadSigner(); // market maker
const BOB = Ed25519Keypair.generate(); // renter

const MARKET = {
  restPrice: DUMMY(0.01),
  tenure: '60s',
  multiTenure: false,
  creditShape: 'linear',
  auctionShape: 'smoothstep',
  descent: '10s',
  handover: 'off', // fresh rent → Bob is active at once; no displacement to wait out
  escalation: { fixed: DUMMY(0.001) },
  retireCommitment: 'immediate',
  ensembleCommitment: 'immediate',
} as const;

async function setup(): Promise<[string, string]> {
  const tx = new Transaction();
  const a1 = tx.moveCall({ target: `${DUMMY_PKG}::dummy_asset::mint` });
  const a2 = tx.moveCall({ target: `${DUMMY_PKG}::dummy_asset::mint` });
  tx.transferObjects([a1, a2], ALICE.toSuiAddress());
  tx.transferObjects([tx.splitCoins(tx.gas, [120_000_000n])[0]!], BOB.toSuiAddress());
  tx.transferObjects(
    [tx.moveCall({ target: `${DUMMY_COIN_PKG}::dummy_coin::mint`, arguments: [tx.object(DUMMY_COIN_TREASURY), tx.pure.u64(2_000_000_000n)] })],
    BOB.toSuiAddress(),
  );
  const res = await send(client, tx, ALICE);
  const created = res.effects!.changedObjects!
    .filter((c) => c.idOperation === 'Created' && res.objectTypes?.[c.objectId]?.includes('::dummy_asset::DummyAsset'))
    .map((c) => c.objectId);
  return [created[0]!, created[1]!];
}

async function main() {
  const [asset1, asset2] = await setup();
  const alice = usufruct({ network: 'testnet', client, signer: ALICE });
  const bob = usufruct({ network: 'testnet', client, signer: BOB });

  const { escrow: e1 } = await alice.integrate({ asset: asset1, coin: DUMMY, market: MARKET });
  const { escrow: e2 } = await alice.integrate({ asset: asset2, coin: DUMMY, market: MARKET });
  console.log(`listed ${e1.id} and ${e2.id}\n`);

  // ─────────── A · MULTI-TX: tx1 rent (deferred) → tx2 borrow with the real id ───────────
  const escrow1 = await bob.escrow(e1.id);
  const cap = await escrow1.rent({ tenures: 1 }).send(); // build → execute → decode, default signer
  console.log('A · tx1 rent().send() →');
  console.log(`   cap.id      ${cap.id}`);
  console.log(`   cap.receipt ${cap.receipt ? `paid ${cap.receipt.paid}, until ${cap.receipt.expiresAt.toISOString()}` : 'NULL ✗'}`);
  if (cap.id == null || cap.receipt == null) throw new Error('A: rich result did NOT survive deferred execution');

  // tx2 — a SEPARATE transaction, using the cap whose real on-chain id came from tx1's effects.
  const { digest: borrowDigest } = await cap.borrow(inspectAsset, useAndKeepCoupon(BOB.toSuiAddress()));
  console.log(`   tx2 borrow  ${borrowDigest}  ← real id flowed tx1 → tx2\n`);

  // ─────────── B · THE SEAM: swap signing, rich result survives ───────────
  // A hand-rolled Executor (stand-in for wallet / Ledger / sponsor): it signs via
  // a different path entirely, never touching the SDK's configured signer.
  const customExecutor: Executor = {
    address: BOB.toSuiAddress(),
    execute: (tx) => send(client, tx, BOB),
  };
  const escrow2 = await bob.escrow(e2.id);
  const cap2 = await escrow2.rent({ tenures: 1 }).send(customExecutor);
  console.log('B · rent().send(customExecutor) →');
  console.log(`   cap.id      ${cap2.id}`);
  console.log(`   cap.receipt ${cap2.receipt ? `paid ${cap2.receipt.paid}` : 'NULL ✗'}  ← rich result survived a swapped signer\n`);
  if (cap2.id == null || cap2.receipt == null) throw new Error('B: rich result did NOT survive a custom executor');

  // ─────────── C · BUILD-ONLY: an unsigned PTB, nothing executed ───────────
  const unsigned = await escrow1.rent({ tenures: 1 }).toTransaction(BOB.toSuiAddress());
  const commands = unsigned.getData().commands.length;
  console.log('C · rent().toTransaction(addr) →');
  console.log(`   built an unsigned PTB with ${commands} commands, sent nothing (offline / wallet / batching).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
