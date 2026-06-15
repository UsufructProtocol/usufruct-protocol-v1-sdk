/**
 * Coin-agnosticism, proven against a REAL second coin on testnet — USDC (6
 * decimals), not the 9-decimal DUMMY every other script uses. The protocol is
 * agnostic to both asset and coin; the SDK must be too. If anything assumed
 * DUMMY's type or 9 decimals, a 6-decimal coin exposes it.
 *
 * The whole coin ceremony is ONE address — `await u.coinType('0x…::usdc::USDC')`
 * resolves decimals (6) and symbol from on-chain CoinMetadata. And rent names no
 * coin at all: `escrow.rent({ tenures: 1 })` draws the escrow's own coin.
 *
 * Single funded actor (we can't mint USDC): Alice integrates an asset priced in
 * USDC and rents her OWN escrow (renting is permissionless — possession is role,
 * nothing forbids the governor renting). Then the tenure settles and she collects.
 *
 *   ① INTEGRATE — priced in USDC; assert floor renders 0.50 USDC (display + mist)
 *   ② RENT      — no coin named; assert the receipt is 0.50 USDC
 *   ③ SETTLE    — tenure lapses; apply
 *   ④ COLLECT   — earnings are 90% = 0.45 USDC (display + mist)
 *
 * Run: `npm run agnostic`.
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

  // The whole coin ceremony: one address. decimals (6) + symbol from CoinMetadata.
  const USDC = await u.coinType('0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC');
  check('u.coinType resolved USDC decimals from chain (6, not the default 9)', USDC.decimals === 6, `${USDC.decimals}`);
  check('u.coinType resolved the symbol', USDC.symbol === 'USDC', USDC.symbol);

  // ════════════ ① INTEGRATE — priced in USDC ════════════
  const { escrow, earningsInbox } = await u.integrate({
    asset: await mintAsset(),
    coin: USDC,
    market: {
      restPrice: USDC(0.5),
      tenure: '20s',
      multiTenure: false,
      creditShape: 'linear',
      auctionShape: 'linear',
      descent: 'off',
      handover: 'off',
      escalation: { fixed: USDC(0.05) },
      retireCommitment: 'immediate',
      ensembleCommitment: 'immediate',
    },
  });
  console.log(`① listed ${escrow.id} — floor ${escrow.floorPrice}`);
  // The COUPLING DETECTOR: the handle must render the floor in USDC's 6 decimals.
  check('escrow.floorPrice mist is exact (0.5 USDC = 500000)', escrow.floorPrice.mist === 500_000n, `${escrow.floorPrice.mist}`);
  check('escrow.floorPrice RENDERS as 0.50 USDC (not 9-decimal coupled)', escrow.floorPrice.toString() === '0.50 USDC', escrow.floorPrice.toString());

  // ════════════ ② RENT — no coin named; the escrow's own coin (USDC) ════════════
  const cap = await escrow.rent({ tenures: 1 });
  console.log(`② rented (no coin named) — paid ${cap.receipt!.paid}`);
  check('receipt.paid mist is exact (500000)', cap.receipt!.paid.mist === 500_000n, `${cap.receipt!.paid.mist}`);
  check('receipt.paid RENDERS as 0.50 USDC', cap.receipt!.paid.toString() === '0.50 USDC', cap.receipt!.paid.toString());

  // ════════════ ③ SETTLE — wait out the tenure, apply ════════════
  console.log('③ waiting out the tenure, then settling…');
  await waitForChainTime(client, BigInt(cap.receipt!.expiresAt.getTime()));
  await (await u.escrow(escrow.id)).applyPendingTransitionStates();

  // ════════════ ④ COLLECT — earnings are 90% of the consumed credit ════════════
  const collected = await earningsInbox.collect();
  const usdc = collected.find((b) => b.coin === USDC.type);
  console.log(`④ collected ${usdc?.amount ?? '(none)'}`);
  check('earnings mist is exact (90% of 0.5 = 0.45 USDC = 450000)', usdc?.amount.mist === 450_000n, `${usdc?.amount.mist}`);
  check('earnings RENDER as 0.45 USDC', usdc?.amount.toString() === '0.45 USDC', `${usdc?.amount}`);

  finish();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
