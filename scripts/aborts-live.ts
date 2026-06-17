/**
 * Live abort mapping (drift-zero errors) — provoke real on-chain aborts and assert
 * the SDK surfaces them by their source name. Run: `npm run aborts`.
 *
 *   ① updateMarket(restPrice = 0) → rest_price_policy::EPriceZero  → InvalidMarket
 *   ② claim() before retire       → asset_state::ENotRetired       → MoveAbortError
 *
 * Aborting txs cost minimal gas; reclaim the escrow with `npm run clean`.
 */
import { Transaction } from '@mysten/sui/transactions';
import { coinTag, usufruct, InvalidMarket, MoveAbortError, type Market } from '@usufruct-protocol/sdk';
import { check, createdId, finish, loadSigner, makeClient, rateLimited, send, step } from './lib.js';

const DUMMY_PKG = '0xa72e830fcb3e688ab3c20ff3cbd0a149cd1b58715709905585e75eb18317a52a';
const DUMMY_COIN_PKG = '0x97fb7c77162e3edf6a44815ec9eb29b69f9a43747dfb1c1019a7fc5501e2ad96';
const DUMMY = coinTag({ type: `${DUMMY_COIN_PKG}::dummy_coin::DUMMY_COIN`, decimals: 9, symbol: 'DUMMY' });

const client = rateLimited(makeClient());
const ALICE = loadSigner();
const me = ALICE.toSuiAddress();

const market: Market = {
  restPrice: DUMMY(0.01),
  tenure: '5m',
  multiTenure: false,
  creditShape: 'linear',
  auctionShape: 'linear',
  descent: 'off',
  handover: '15s',
  escalation: { fixed: DUMMY(0.001) },
  retireCommitment: 'immediate',
  ensembleCommitment: 'immediate',
};

async function mintAsset(): Promise<string> {
  const tx = new Transaction();
  tx.transferObjects([tx.moveCall({ target: `${DUMMY_PKG}::dummy_asset::mint` })], me);
  return createdId(await send(client, tx, ALICE), '::dummy_asset::DummyAsset');
}

/** Run a write that must abort; return the caught error (or throw if it didn't). */
async function expectAbort(label: string, run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (e) {
    return e;
  }
  throw new Error(`${label}: expected an abort, but the write succeeded`);
}

async function main(): Promise<void> {
  const u = usufruct({ network: 'testnet', client, signer: ALICE });

  step('setup — integrate an escrow');
  const { escrow, governanceCap } = await u.integrate({ asset: await mintAsset(), coin: DUMMY, market });
  console.log(`  escrow ${escrow.id.slice(0, 12)}…`);

  step('① updateMarket(restPrice = 0) → rest_price_policy::EPriceZero');
  const e1 = await expectAbort('updateMarket', () => governanceCap.updateMarket(escrow.id, { restPrice: escrow.coin(0) }));
  check('typed as InvalidMarket (overlay)', e1 instanceof InvalidMarket, (e1 as Error).constructor.name);
  check('abort names the Move constant EPriceZero', (e1 as MoveAbortError).abort === 'EPriceZero', (e1 as MoveAbortError).abort);
  check('carries module + code', (e1 as MoveAbortError).module === 'rest_price_policy' && (e1 as MoveAbortError).code === 0, `${(e1 as MoveAbortError).module} #${(e1 as MoveAbortError).code}`);
  console.log(`  message: ${(e1 as Error).message}`);

  step('② claim() before retire → asset_state::ENotRetired');
  const e2 = await expectAbort('claim', () => governanceCap.claim(escrow.id));
  check('typed as MoveAbortError', e2 instanceof MoveAbortError, (e2 as Error).constructor.name);
  check('abort names the Move constant ENotRetired', (e2 as MoveAbortError).abort === 'ENotRetired', (e2 as MoveAbortError).abort);
  console.log(`  message: ${(e2 as Error).message}`);
}

main().then(finish);
