/**
 * Reclaim storage rebate from the signer's accumulated owned objects (testnet
 * cruft from many script runs). Consumes each object via its destroy path —
 * transferring would NOT return the rebate. Batches ~50 ops per PTB.
 *
 *   • Coin<T>        → merge same-type coins into one (SUI left as gas)
 *   • GovernanceCap  → cap::renounce_governance   (per owning package)
 *   • UsufructCap    → cap::burn_usufruct_cap      (per owning package)
 *   • DummyAsset     → dummy_asset::burn
 *   • Coupon         → dummy_asset::burn_coupon
 *   • EarningsInbox  → SKIPPED by design: it is the receive() target for
 *                      EarningsMessage objects (transfer-to-object). Deleting it
 *                      would strand any unreceived earnings forever — receive()
 *                      needs the target to exist, and you can't prove on-chain that
 *                      none are pending. So there is intentionally no destructor.
 *
 * Run: `npx tsx scripts/reclaim.ts`  (add `--dry` to only list).
 */
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { Transaction } from '@mysten/sui/transactions';
import { renounceGovernance, burnUsufructCap } from '@usufruct-protocol/sdk/codegen/usufruct/cap.js';
import { check, finish, loadSigner, makeClient, rateLimited, retry429, send, step } from './lib.js';

const DUMMY_PKG = '0xa72e830fcb3e688ab3c20ff3cbd0a149cd1b58715709905585e75eb18317a52a';
const DRY = process.argv.includes('--dry');
const BATCH = 50;
const GAS_FLOOR_MIST = 50_000_000n; // stop below ~0.05 SUI

const client = rateLimited(makeClient());
const rpc = new SuiJsonRpcClient({ network: 'testnet', url: 'https://fullnode.testnet.sui.io:443' });
const ALICE = loadSigner();
const me = ALICE.toSuiAddress();

type Obj = { id: string; type: string };
type Page = { objects: { objectId: string; type?: string }[]; hasNextPage: boolean; cursor?: string | null };

async function ownedByType(): Promise<Map<string, Obj[]>> {
  const byType = new Map<string, Obj[]>();
  let cursor: string | null = null;
  for (;;) {
    const page = (await client.core.listOwnedObjects({ owner: me, cursor, limit: 50 })) as Page;
    for (const o of page.objects) {
      const type = o.type ?? 'unknown';
      const base = type.replace(/<.*$/, ''); // strip generics
      (byType.get(base) ?? byType.set(base, []).get(base)!).push({ id: o.objectId, type });
    }
    if (!page.hasNextPage) break;
    cursor = page.cursor ?? null;
  }
  return byType;
}

/** `<pkg>::module::Name` → pkg. */
const pkgOf = (type: string): string => type.split('::')[0]!;

async function gasOk(): Promise<boolean> {
  const b = (await retry429(() => rpc.getBalance({ owner: me, coinType: '0x2::sui::SUI' }))) as { totalBalance: string };
  return BigInt(b.totalBalance) > GAS_FLOOR_MIST;
}

async function runBatches(label: string, ops: ((tx: Transaction) => void)[]): Promise<void> {
  let done = 0;
  for (let i = 0; i < ops.length; i += BATCH) {
    if (!(await gasOk())) {
      console.log(`  [stop] gas below floor — ${label}: ${done}/${ops.length} done`);
      return;
    }
    const slice = ops.slice(i, i + BATCH);
    const tx = new Transaction();
    for (const op of slice) op(tx);
    const res = await send(client, tx, ALICE);
    done += slice.length;
    console.log(`  ${label}: ${done}/${ops.length} (digest ${res.digest.slice(0, 10)}…)`);
  }
  check(`${label} reclaimed`, done === ops.length, `${done}/${ops.length}`);
}

async function main(): Promise<void> {
  step('inventory');
  const byType = await ownedByType();
  for (const [t, objs] of [...byType.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${String(objs.length).padStart(4)}  ${t.replace(/^0x[0-9a-f]{6}[0-9a-f]+/, (m) => m.slice(0, 8) + '…')}`);
  }
  if (DRY) return finish();

  // ── Coins: merge same-type into one (skip SUI — it's the gas coin) ──
  const coins = byType.get('0x0000000000000000000000000000000000000000000000000000000000000002::coin::Coin') ?? [];
  const byCoinType = new Map<string, string[]>();
  for (const c of coins) {
    if (c.type.includes('::sui::SUI')) continue;
    (byCoinType.get(c.type) ?? byCoinType.set(c.type, []).get(c.type)!).push(c.id);
  }
  step('merge coins');
  if (byCoinType.size === 0) console.log('  (no non-SUI coins to merge)');
  else {
    const tx = new Transaction();
    for (const [type, ids] of byCoinType) {
      if (ids.length < 2) continue;
      const [primary, ...rest] = ids;
      tx.mergeCoins(tx.object(primary!), rest.map((id) => tx.object(id)));
      console.log(`  ${type.replace(/^.*<(.*)>$/, '$1').split('::').pop()}: ${ids.length} → 1`);
    }
    const res = await send(client, tx, ALICE);
    check('coins merged', true, res.digest.slice(0, 10) + '…');
  }

  // ── Burn caps (per owning package) + dummy assets/coupons ──
  const govCaps = [...byType.entries()].filter(([t]) => t.endsWith('::governance_cap::GovernanceCap')).flatMap(([, o]) => o);
  const useCaps = [...byType.entries()].filter(([t]) => t.endsWith('::usufruct_cap::UsufructCap')).flatMap(([, o]) => o);
  const assets = byType.get(`${DUMMY_PKG}::dummy_asset::DummyAsset`) ?? [];
  const coupons = byType.get(`${DUMMY_PKG}::dummy_asset::Coupon`) ?? [];

  step(`burn ${govCaps.length} GovernanceCap`);
  await runBatches('GovernanceCap', govCaps.map((c) => (tx: Transaction) => { renounceGovernance({ package: pkgOf(c.type), arguments: [tx.object(c.id)] })(tx); }));

  step(`burn ${useCaps.length} UsufructCap`);
  await runBatches('UsufructCap', useCaps.map((c) => (tx: Transaction) => { burnUsufructCap({ package: pkgOf(c.type), arguments: [tx.object(c.id)] })(tx); }));

  step(`burn ${assets.length} DummyAsset`);
  await runBatches('DummyAsset', assets.map((a) => (tx: Transaction) => { tx.moveCall({ target: `${DUMMY_PKG}::dummy_asset::burn`, arguments: [tx.object(a.id)] }); }));

  step(`burn ${coupons.length} Coupon`);
  await runBatches('Coupon', coupons.map((c) => (tx: Transaction) => { tx.moveCall({ target: `${DUMMY_PKG}::dummy_asset::burn_coupon`, arguments: [tx.object(c.id)] }); }));

  const inboxes = [...byType.entries()].filter(([t]) => t.endsWith('::earnings_inbox::EarningsInbox')).flatMap(([, o]) => o);
  console.log(`\n  [skip] ${inboxes.length} EarningsInbox — no destructor by design (it's the receive() target for EarningsMessages; deleting it would orphan unreceived funds)`);
}

main().then(finish);
