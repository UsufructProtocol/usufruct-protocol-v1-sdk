/**
 * Reclaim testnet cruft — and exercise the retire→claim path at scale.
 *
 * Every script run leaves a shared `Escrow` behind. This sweeps the ones THIS
 * address still governs and are idle: retire + claim in a single PTB, which
 * deletes the Escrow and returns its storage rebate to the sender (so cleanup is
 * roughly gas-neutral, often net-positive). Doubles as an end-to-end exercise of
 * `retire` + `claim_asset` over many real escrows.
 *
 * Discovery: `AssetIntegrated` events with our address as sender (the integrator)
 * → escrow + governance-cap ids; we keep only the ones still idle and still ours.
 *
 * Run: `npm run clean`  (add `--dry` to only list, no transactions).
 */
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { Transaction } from '@mysten/sui/transactions';
import { retire as retireCall, claimAsset as claimCall } from '../src/codegen/usufruct/escrow.js';
import { TESTNET } from '../src/config/network.js';
import { usufruct } from '../src/index.js';
import { fetchTypeArgs } from '../src/highlevel/typeargs.js';
import { loadSigner, makeClient, rateLimited, send, sleep } from './lib.js';

const PKG = TESTNET.packageId;
const DRY = process.argv.includes('--dry');
const GAS_FLOOR_MIST = 12_000_000n; // stop if SUI dips below ~0.012 (one tx of headroom)

const client = rateLimited(makeClient());
const rpc = new SuiJsonRpcClient({ network: 'testnet', url: 'https://fullnode.testnet.sui.io:443' });
const ALICE = loadSigner();
const me = ALICE.toSuiAddress();

interface Listed {
  readonly escrowId: string;
  readonly govCapId: string;
}

/** Every escrow this address integrated (newest first), via AssetIntegrated events. */
async function discover(): Promise<Listed[]> {
  const type = `${PKG}::asset_state::AssetIntegrated`;
  const out: Listed[] = [];
  const seen = new Set<string>();
  let cursor: unknown = null;
  do {
    const r = (await rpc.queryEvents({ query: { MoveEventType: type }, cursor: cursor as never, limit: 50, order: 'descending' })) as {
      data: Array<{ sender?: string; parsedJson: { escrow_id: string; governance_cap_id: string; governor_address: string } }>;
      hasNextPage: boolean;
      nextCursor: unknown;
    };
    for (const e of r.data) {
      const j = e.parsedJson;
      if (j.governor_address !== me && e.sender !== me) continue;
      if (seen.has(j.escrow_id)) continue;
      seen.add(j.escrow_id);
      out.push({ escrowId: j.escrow_id, govCapId: j.governance_cap_id });
    }
    cursor = r.hasNextPage ? r.nextCursor : null;
  } while (cursor);
  return out;
}

/** Current SUI balance (mist) of the signer. */
async function suiMist(): Promise<bigint> {
  const b = (await rpc.getBalance({ owner: me, coinType: '0x2::sui::SUI' })) as { totalBalance: string };
  return BigInt(b.totalBalance);
}

async function main() {
  const u = usufruct({ network: 'testnet', client, signer: ALICE });
  const listed = await discover();
  console.log(`discovered ${listed.length} escrow(s) integrated by ${me.slice(0, 10)}…\n`);

  const before = await suiMist();
  let cleaned = 0;
  let skipped = 0;

  for (const { escrowId, govCapId } of listed) {
    // Already deleted (claimed in a previous sweep)?
    let typeArgs: [string, string];
    try {
      typeArgs = await fetchTypeArgs(client, escrowId);
    } catch {
      skipped++;
      continue; // gone already
    }

    // Only sweep escrows we still govern AND that are idle (claimable after retire).
    const escrow = await u.escrow(escrowId).catch(() => null);
    if (escrow == null || !escrow.canGovern) {
      skipped++;
      continue;
    }
    if (!(escrow.status === 'idle' || escrow.status === 'descent')) {
      console.log(`  [skip] ${escrowId.slice(0, 10)}… status=${escrow.status} (in use)`);
      skipped++;
      continue;
    }

    if (DRY) {
      console.log(`  [dry]  would retire+claim ${escrowId.slice(0, 10)}… (${escrow.status})`);
      cleaned++;
      continue;
    }

    if ((await suiMist()) < GAS_FLOOR_MIST) {
      console.log('  [stop] SUI below the gas floor — run again after the rebate settles');
      break;
    }

    // retire + claim in ONE PTB: escrow goes in &mut (retire) then by value (claim),
    // the cap is a shared ref both times; the asset comes back to us, escrow deleted.
    const tx = new Transaction();
    const escrowArg = tx.object(escrowId);
    const capArg = tx.object(govCapId);
    retireCall({ package: PKG, arguments: [escrowArg, capArg], typeArguments: typeArgs })(tx);
    const asset = claimCall({ package: PKG, arguments: [escrowArg, capArg], typeArguments: typeArgs })(tx);
    tx.transferObjects([asset], me);

    try {
      const res = await send(client, tx, ALICE);
      const g = res.effects?.gasUsed;
      const net = g ? BigInt(g.storageRebate) - BigInt(g.computationCost) - BigInt(g.storageCost) : 0n;
      console.log(`  [done] ${escrowId.slice(0, 10)}… retired+claimed · net ${net >= 0n ? '+' : ''}${net} mist`);
      cleaned++;
    } catch (e) {
      console.log(`  [fail] ${escrowId.slice(0, 10)}… ${String(e).slice(0, 80)}`);
      skipped++;
    }
    await sleep(200);
  }

  const after = await suiMist();
  console.log(`\n${DRY ? '[dry] ' : ''}cleaned ${cleaned}, skipped ${skipped}.`);
  if (!DRY) {
    const delta = after - before;
    console.log(`SUI ${before} → ${after} mist (${delta >= 0n ? 'reclaimed +' : 'spent '}${delta} mist)`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
