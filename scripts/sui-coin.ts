/**
 * SUI — the native coin, for completeness. The third coin after DUMMY (9-dec
 * custom) and USDC (6-dec real). SUI is special: it's the gas coin itself, so
 * its payment splits from `tx.gas` (resolvePayment's SUI branch), a different
 * path than the owned-coin select/merge every other coin takes. Same agnostic
 * flow, and **zero coin ceremony at rent** — the escrow already dictates the coin.
 *
 *   ① INTEGRATE — priced in SUI; the coin comes from just its address
 *   ② RENT      — escrow.rent({ tenures: 1 }) — NO payment arg, no coin named
 *   ③ SETTLE    — tenure lapses; apply
 *   ④ COLLECT   — earnings are 90% of the consumed credit
 *
 * Run: `npm run sui`.
 */
import { Transaction } from '@mysten/sui/transactions';
import { usufruct } from '../src/index.js';
import { check, createdId, finish, loadSigner, makeClient, rateLimited, send, waitForChainTime } from './lib.js';

const DUMMY_PKG = '0xa72e830fcb3e688ab3c20ff3cbd0a149cd1b58715709905585e75eb18317a52a';

const client = rateLimited(makeClient());
const ALICE = loadSigner();
const me = ALICE.toSuiAddress();

async function mintAsset(): Promise<string> {
  const tx = new Transaction();
  tx.transferObjects([tx.moveCall({ target: `${DUMMY_PKG}::dummy_asset::mint` })], me);
  return createdId(await send(client, tx, ALICE), '::dummy_asset::DummyAsset');
}

async function main() {
  const u = usufruct({ network: 'testnet', client, signer: ALICE });

  // The whole coin ceremony: one address. (SUI short-circuits — no metadata call.)
  const SUI = await u.coinType('0x2::sui::SUI');
  check('SUI resolves 9 decimals + symbol from just the address', SUI.decimals === 9 && SUI.symbol === 'SUI', `${SUI.decimals}/${SUI.symbol}`);

  // ════════════ ① INTEGRATE — priced in SUI ════════════
  const { escrow, earningsInbox } = await u.integrate({
    asset: await mintAsset(),
    coin: SUI,
    market: {
      restPrice: SUI(0.1),
      tenure: '20s',
      multiTenure: false,
      creditShape: 'linear',
      auctionShape: 'linear',
      descent: 'off',
      handover: 'off',
      escalation: { fixed: SUI(0.01) },
      retireCommitment: 'immediate',
      ensembleCommitment: 'immediate',
    },
  });
  console.log(`① listed ${escrow.id} — floor ${escrow.floorPrice}`);
  check('escrow.floorPrice mist is exact (0.1 SUI = 100000000)', escrow.floorPrice.mist === 100_000_000n, `${escrow.floorPrice.mist}`);
  check('escrow.floorPrice renders as 0.10 SUI', escrow.floorPrice.toString() === '0.10 SUI', escrow.floorPrice.toString());

  // ════════════ ② RENT — no payment arg; the escrow's coin, split from gas ════════════
  const cap = await escrow.rent({ tenures: 1 });
  console.log(`② rented (no coin named) — paid ${cap.receipt!.paid}`);
  check('paid 0.10 SUI, drawn from the escrow’s own coin', cap.receipt!.paid.mist === 100_000_000n, `${cap.receipt!.paid.mist}`);

  // ════════════ ③ SETTLE — wait out the tenure, apply ════════════
  console.log('③ waiting out the tenure, then settling…');
  await waitForChainTime(client, BigInt(cap.receipt!.expiresAt.getTime()));
  await (await u.escrow(escrow.id)).applyPendingTransitionStates();

  // ════════════ ④ COLLECT — earnings are 90% of the consumed credit ════════════
  const collected = await earningsInbox.collect();
  const sui = collected.find((b) => b.coin === SUI.type);
  console.log(`④ collected ${sui?.amount ?? '(none)'}`);
  check('earnings mist is exact (90% of 0.1 = 0.09 SUI = 90000000)', sui?.amount.mist === 90_000_000n, `${sui?.amount.mist}`);
  check('earnings render as 0.09 SUI', sui?.amount.toString() === '0.09 SUI', `${sui?.amount}`);

  finish();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
