/**
 * PROBE — the escalation ladder: a market's bid-escalation policy made visible.
 *
 * `escrow.nextFloorPrice(bid, tenures)` answers ONE step — what the bar becomes if I
 * bid now. `escrow.escalationLadder()` answers the whole staircase: from the current
 * floor, the price a challenger must clear after each SUCCESSIVE displacement —
 * f(start), f(f(start)), … — so you read the policy's shape directly:
 *
 *   • fixed delta   → a LINEAR ladder (each rung adds the same amount)
 *   • compound delta → a CONVEX ladder (each rung adds a fraction of the last)
 *
 * It surfaces the third parameterized view this batch added (`ascending_floor_with`):
 * the whole ladder is ONE simulation — the u64 return of each rung feeds the next, the
 * policy is built on-chain once. No graphql; it reads the live ensemble.
 *
 * Run from the monorepo root:  npx tsx examples/escalation-ladder/index.ts
 * Fast — no tenure/descent waits.
 */
import { Transaction } from '@mysten/sui/transactions';
import { coinTag, usufruct } from '@usufruct-protocol/sdk';
import type { LadderRung } from '@usufruct-protocol/sdk';
import type { Market } from '@usufruct-protocol/sdk';
import { check, createdId, finish, loadSigner, makeClient, rateLimited, send, step } from '../../scripts/lib.js';

const DUMMY_PKG = '0xa72e830fcb3e688ab3c20ff3cbd0a149cd1b58715709905585e75eb18317a52a';
const DUMMY_COIN_PKG = '0x97fb7c77162e3edf6a44815ec9eb29b69f9a43747dfb1c1019a7fc5501e2ad96';
const DUMMY = coinTag({ type: `${DUMMY_COIN_PKG}::dummy_coin::DUMMY_COIN`, decimals: 9, symbol: 'DUMMY' });

const client = rateLimited(makeClient());
const me = loadSigner();

const baseMarket: Omit<Market, 'escalation'> = {
  restPrice: DUMMY(0.5), tenure: '60s', multiTenure: false,
  creditShape: 'linear', auctionShape: 'linear',
  descent: 'off', handover: 'off',
  retireCommitment: 'immediate', ensembleCommitment: 'immediate',
};

async function mintAsset(): Promise<string> {
  const tx = new Transaction();
  tx.transferObjects([tx.moveCall({ target: `${DUMMY_PKG}::dummy_asset::mint` })], me.toSuiAddress());
  return createdId(await send(client, tx, me), '::dummy_asset::DummyAsset');
}

async function ladderFor(escalation: Market['escalation']): Promise<LadderRung[]> {
  const u = usufruct({ client, signer: me });
  const { escrow } = await u.integrate({ asset: await mintAsset(), coin: DUMMY, market: { ...baseMarket, escalation } }).send();
  return (await u.escrow(escrow.id)).escalationLadder({ steps: 10, from: DUMMY(0.5) });
}

/** Two ladders side by side at a shared scale — read the policy shape off the bars. */
function render(a: LadderRung[], b: LadderRung[], labelA: string, labelB: string, width = 24): string {
  const max = [...a, ...b].reduce((m, r) => (r.price.mist > m ? r.price.mist : m), 0n);
  const bar = (r: LadderRung): string => {
    const len = max === 0n ? 0 : Math.max(0, Math.round((Number(r.price.mist) / Number(max)) * width));
    return `${r.price.toSui().toFixed(4)} ${('█'.repeat(len) + ' '.repeat(width)).slice(0, width)}`;
  };
  const head = `   step    ${labelA.padEnd(width + 8)} ${labelB}`;
  const rows = a.map((r, i) => `   #${String(r.step).padStart(2)}     ${bar(r)} ${bar(b[i]!)}`);
  return `${head}\n${rows.join('\n')}`;
}

async function main() {
  step('two markets, same 0.5 floor — fixed(+0.05) vs compound(20% + 0.001)');
  const fixed = await ladderFor({ fixed: DUMMY(0.05) });
  const compound = await ladderFor({ compound: { bps: 2000, delta: DUMMY(0.001) } });

  step('escrow.escalationLadder() — the bar after each successive displacement');
  console.log(render(fixed, compound, 'fixed(+0.05) — linear', 'compound(20%) — convex') + '\n');

  const fixedStep = fixed[2]!.price.mist - fixed[1]!.price.mist;
  const fixedStep2 = fixed[5]!.price.mist - fixed[4]!.price.mist;
  const compStep = compound[2]!.price.mist - compound[1]!.price.mist;
  const compStep2 = compound[5]!.price.mist - compound[4]!.price.mist;
  console.log(`   fixed:    every rung +${(Number(fixedStep) / 1e9).toFixed(4)} (constant)`);
  console.log(`   compound: rung 1→2 +${(Number(compStep) / 1e9).toFixed(4)}, rung 4→5 +${(Number(compStep2) / 1e9).toFixed(4)} (growing)`);

  check('fixed ladder is linear (equal rungs)', fixedStep === fixedStep2, `${fixedStep} vs ${fixedStep2}`);
  check('compound ladder is convex (rising rungs)', compStep2 > compStep, `${compStep2} > ${compStep}`);
  check('both rise monotonically', fixed.every((r, i) => i === 0 || r.price.mist > fixed[i - 1]!.price.mist) && compound.every((r, i) => i === 0 || r.price.mist > compound[i - 1]!.price.mist));

  finish();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
