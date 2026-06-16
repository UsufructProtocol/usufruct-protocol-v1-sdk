/**
 * Reclaim testnet cruft — and exercise the retire→claim path at scale.
 *
 * Every script run leaves a shared `Escrow` behind. This sweeps the ones THIS
 * address still governs and are idle: retire + claim in a single PTB, which
 * deletes the Escrow and returns its storage rebate to the sender (so cleanup is
 * roughly gas-neutral, often net-positive). Doubles as an end-to-end exercise of
 * `retire` + `claim_asset` over many real escrows.
 *
 * Discovery is high-level AND object-centric: `u.escrowsGovernedBy(me)` lists the
 * escrows whose `GovernanceCap` we HOLD right now (the cap→escrow link lives only
 * in the event log — the cap doesn't store it). So possession is guaranteed by
 * discovery; we just keep the ones that are idle (claimable after retire).
 *
 * Run: `npm run clean`  (add `--dry` to only list, no transactions).
 */
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { Transaction } from '@mysten/sui/transactions';
import { retire as retireCall, claimAsset as claimCall } from '../src/codegen/usufruct/escrow.js';
import { GRAPHQL_TESTNET, TESTNET } from '../src/config/network.js';
import { usufruct } from '../src/index.js';
import { loadSigner, makeClient, rateLimited, retry429, send, sleep } from './lib.js';

const PKG = TESTNET.packageId;
const DRY = process.argv.includes('--dry');
const GAS_FLOOR_MIST = 12_000_000n; // stop if SUI dips below ~0.012 (one tx of headroom)

const client = rateLimited(makeClient());
const rpc = new SuiJsonRpcClient({ network: 'testnet', url: 'https://fullnode.testnet.sui.io:443' });
const ALICE = loadSigner();
const me = ALICE.toSuiAddress();

/** Current SUI balance (mist) of the signer. */
async function suiMist(): Promise<bigint> {
  const b = (await retry429(() => rpc.getBalance({ owner: me, coinType: '0x2::sui::SUI' }))) as { totalBalance: string };
  return BigInt(b.totalBalance);
}

async function main() {
  const u = usufruct({ network: 'testnet', client, signer: ALICE, graphql: GRAPHQL_TESTNET });
  const listed = await u.escrowsGovernedBy(me); // ← escrows whose cap we hold (possession)
  console.log(`discovered ${listed.length} escrow(s) governed by ${me.slice(0, 10)}…\n`);

  const before = await suiMist();
  let cleaned = 0;
  let skipped = 0;

  for (const l of listed) {
    // Possession is guaranteed by discovery (we hold the cap). The handle resolves
    // type args (decode-free); if the escrow was already claimed in a prior sweep,
    // this throws → skip. Otherwise we only need its status.
    const escrow = await l.escrow().catch(() => null);
    if (escrow == null) {
      skipped++;
      continue; // gone already
    }
    // Only idle/descent escrows are claimable after retire.
    if (!(escrow.status === 'idle' || escrow.status === 'descent')) {
      console.log(`  [skip] ${l.escrowId.slice(0, 10)}… status=${escrow.status} (in use)`);
      skipped++;
      continue;
    }

    if (DRY) {
      console.log(`  [dry]  would retire+claim ${l.escrowId.slice(0, 10)}… (${escrow.status})`);
      cleaned++;
      continue;
    }

    if ((await suiMist()) < GAS_FLOOR_MIST) {
      console.log('  [stop] SUI below the gas floor — run again after the rebate settles');
      break;
    }

    // retire + claim in ONE PTB: escrow goes in &mut (retire) then by value (claim),
    // the GovernanceCap (we hold it — canGovern) is a shared ref both times; the
    // asset comes back to us, the escrow is deleted.
    const typeArgs: [string, string] = [escrow.assetType, escrow.coinType];
    const tx = new Transaction();
    const escrowArg = tx.object(l.escrowId);
    const capArg = tx.object(escrow.governanceCapId);
    retireCall({ package: PKG, arguments: [escrowArg, capArg], typeArguments: typeArgs })(tx);
    const asset = claimCall({ package: PKG, arguments: [escrowArg, capArg], typeArguments: typeArgs })(tx);
    tx.transferObjects([asset], me);

    try {
      const res = await send(client, tx, ALICE);
      const g = res.effects?.gasUsed;
      const net = g ? BigInt(g.storageRebate) - BigInt(g.computationCost) - BigInt(g.storageCost) : 0n;
      console.log(`  [done] ${l.escrowId.slice(0, 10)}… retired+claimed · net ${net >= 0n ? '+' : ''}${net} mist`);
      cleaned++;
    } catch (e) {
      console.log(`  [fail] ${l.escrowId.slice(0, 10)}… ${String(e).slice(0, 80)}`);
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
