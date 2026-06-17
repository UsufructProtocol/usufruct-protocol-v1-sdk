/**
 * The floor is the minimum, not the maximum — paying the floor vs overpaying,
 * end to end on testnet. Renting pays `floorPrice × tenures` by default; pay more
 * and the surplus becomes stake (more credit/time). The two flows side by side.
 *
 *   ① FLOOR   — rent with no `pay`; charged exactly the floor
 *   ② OVERPAY — pay ABOVE the floor → the surplus lands as on-chain stake
 *
 * Note the asymmetry the API makes honest: to overpay you must first KNOW the
 * floor. So the overpay flow reads `escrow.floorPrice` and derives the amount
 * from it (`floor.scale(1.5)`), rather than hardcoding a number disconnected from
 * the live floor. Single actor (self-rent — permissionless), two fresh escrows so
 * each stake is cleanly attributable.
 *
 * Run: `npm run pricing`.
 */
import { Transaction } from '@mysten/sui/transactions';
import { coinTag, usufruct, type Market } from '@usufruct-protocol/sdk';
import { check, createdId, finish, loadSigner, makeClient, rateLimited, send } from './lib.js';

const DUMMY_PKG = '0xa72e830fcb3e688ab3c20ff3cbd0a149cd1b58715709905585e75eb18317a52a';
const DUMMY_COIN_PKG = '0x97fb7c77162e3edf6a44815ec9eb29b69f9a43747dfb1c1019a7fc5501e2ad96';
const DUMMY = coinTag({ type: `${DUMMY_COIN_PKG}::dummy_coin::DUMMY_COIN`, decimals: 9, symbol: 'DUMMY' });

const client = rateLimited(makeClient());
const ALICE = loadSigner();
const me = ALICE.toSuiAddress();

const MARKET: Market = {
  restPrice: DUMMY(0.01), // floor = 0.01 DUMMY
  tenure: '2m',
  multiTenure: false,
  creditShape: 'linear',
  auctionShape: 'linear',
  descent: 'off',
  handover: 'off',
  escalation: { fixed: DUMMY(0.001) },
  retireCommitment: 'immediate',
  ensembleCommitment: 'immediate',
};

async function mintAsset(): Promise<string> {
  const tx = new Transaction();
  tx.transferObjects([tx.moveCall({ target: `${DUMMY_PKG}::dummy_asset::mint` })], me);
  return createdId(await send(client, tx, ALICE), '::dummy_asset::DummyAsset');
}

async function main() {
  const u = usufruct({ network: 'testnet', client, signer: ALICE });

  // ════════════ ① FLOOR — pay the default ════════════
  const { escrow: e1 } = await u.integrate({ asset: await mintAsset(), coin: DUMMY, market: MARKET });
  console.log(`① floor is ${e1.floorPrice}; rent with no \`pay\``);
  const cap1 = await e1.rent({ tenures: 1 }); // no pay → floor × tenures
  console.log(`   paid ${cap1.receipt!.paid}`);
  check('paid exactly the floor (0.01 DUMMY)', cap1.receipt!.paid.mist === DUMMY(0.01).mist, `${cap1.receipt!.paid.mist}`);
  const stake1 = await (await u.escrow(e1.id)).reader.activeStakeBalanceMist();
  check('stake on-chain == floor', stake1 === DUMMY(0.01).mist, `${stake1}`);

  // ════════════ ② OVERPAY — know the floor first, then pay above it ════════════
  const { escrow: e2 } = await u.integrate({ asset: await mintAsset(), coin: DUMMY, market: MARKET });
  // To overpay you must KNOW the floor — read it, then derive the amount from it.
  const floor = e2.floorPrice;
  const want = floor.scale(1.5); // 50% over the live floor, derived from it
  console.log(`\n② floor is ${floor}; choose to pay ${want} (1.5× floor)`);
  const cap2 = await e2.rent({ tenures: 1, pay: want });
  console.log(`   paid ${cap2.receipt!.paid}`);
  check('paid the chosen overpay (0.015 DUMMY)', cap2.receipt!.paid.mist === want.mist, `${cap2.receipt!.paid.mist}`);
  const stake2 = await (await u.escrow(e2.id)).reader.activeStakeBalanceMist();
  check('the surplus became stake on-chain (stake == overpay)', stake2 === want.mist, `${stake2}`);
  check('stake is strictly above the floor', (stake2 ?? 0n) > floor.mist, `${stake2} > ${floor.mist}`);

  finish();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
