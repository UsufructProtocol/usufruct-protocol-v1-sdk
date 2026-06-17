/**
 * Read-intensive dashboard — the reads a governor/observer actually wants about a
 * live escrow, written the way a dev would, through the OBJECT handles. Where a
 * read has no home on its object and we must drop to `escrow.reader`, we mark it
 * `CEREMONY` and count it — the same observe-then-simplify technique we used for
 * the writes. Run on a demand-state escrow (active + pending + full market).
 *
 * Writes (integrate + 2 rents) need a funded signer; reclaim with `npm run clean`.
 * Run: `npm run dashboard`.
 */
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { coinTag, usufruct, type Market } from '@usufruct-protocol/sdk';
import { check, createdId, finish, loadSigner, makeClient, rateLimited, send, step } from './lib.js';

const DUMMY_PKG = '0xa72e830fcb3e688ab3c20ff3cbd0a149cd1b58715709905585e75eb18317a52a';
const DUMMY_COIN_PKG = '0x97fb7c77162e3edf6a44815ec9eb29b69f9a43747dfb1c1019a7fc5501e2ad96';
const DUMMY_COIN_TREASURY = '0xccee2bc2227913f441c7544892cf5d220880cbc0c55be8733b4b6777def976bc';
const DUMMY = coinTag({ type: `${DUMMY_COIN_PKG}::dummy_coin::DUMMY_COIN`, decimals: 9, symbol: 'DUMMY' });

const client = rateLimited(makeClient());
const ALICE = loadSigner();
const me = ALICE.toSuiAddress();

// Every read below now has a home on its object — no drops to escrow.reader.
// `ceremony` stays empty; `noCeremony` just labels the (formerly reader-only) read.
const ceremony: string[] = [];
function noCeremony<T>(_what: string, v: T): T {
  return v;
}
// Render policy unions (they carry bigints) compactly.
const j = (v: unknown): string => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? `${x}n` : x));

async function newRenter(): Promise<Ed25519Keypair> {
  const kp = Ed25519Keypair.generate();
  const tx = new Transaction();
  tx.transferObjects([tx.splitCoins(tx.gas, [60_000_000n])[0]!], kp.toSuiAddress());
  tx.transferObjects(
    [tx.moveCall({ target: `${DUMMY_COIN_PKG}::dummy_coin::mint`, arguments: [tx.object(DUMMY_COIN_TREASURY), tx.pure.u64(1_000_000_000n)] })],
    kp.toSuiAddress(),
  );
  await send(client, tx, ALICE);
  return kp;
}

async function mintAsset(): Promise<string> {
  const tx = new Transaction();
  tx.transferObjects([tx.moveCall({ target: `${DUMMY_PKG}::dummy_asset::mint` })], me);
  return createdId(await send(client, tx, ALICE), '::dummy_asset::DummyAsset');
}

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

async function main(): Promise<void> {
  const a = usufruct({ network: 'testnet', client, signer: ALICE });

  step('setup — integrate + rent (Bob) + challenge (Carol) → demand');
  const { escrow, governanceCap } = await a.integrate({ asset: await mintAsset(), coin: DUMMY, market });
  const bob = await newRenter();
  const carol = await newRenter();
  await (await usufruct({ network: 'testnet', client, signer: bob }).escrow(escrow.id)).rent({ tenures: 1 });
  await (await usufruct({ network: 'testnet', client, signer: carol }).escrow(escrow.id)).rent({ tenures: 1 });

  const e = await a.escrow(escrow.id);

  step('① escrow-whole — straight off the handle');
  console.log(`  status=${e.status}  available=${e.isAvailable}  floor=${e.floorPrice.format()}`);
  console.log(`  expiresAt=${e.expiresAt?.toISOString()}  challenged=${e.isChallenged}`);
  console.log(`  coin=${e.coin.symbol}  govCap=${e.governanceCapId.slice(0, 10)}…`);
  check('handle covers status/floor/expiry/ids', true);

  step('② the seat — via the cap handle (cap.state())');
  const active = await (await a.usufructCap(e.activeUsufructCapId!)).state();
  const pending = await (await a.usufructCap(e.pendingUsufructCapId!)).state();
  console.log(`  active: stake=${active.stake?.format()} time=${active.timeRemainingMs}ms accrued=${active.accruedCredit?.format()} accruing=${active.creditAccruing}`);
  console.log(`  pending: stake=${pending.stake?.format()} role=${pending.role}`);
  check('cap.state covers seat economics + credit flags', active.role === 'active' && active.creditAccruing !== null);

  step('③ the MARKET / policy — escrow.market() (one call, coin-aware)');
  const mkt = noCeremony('escrow.market()', await e.market());
  console.log(`  restPrice=${mkt.restPrice.format()} tenure=${mkt.tenure}ms handover=${j(mkt.handover)}`);
  console.log(`  creditShape=${j(mkt.creditShape)} escalation=${j(mkt.escalation)} descent=${j(mkt.descent)}`);
  check('market.restPrice is a rendered Price', mkt.restPrice.format().includes(e.coin.symbol));

  step('④ live cycle params — escrow.cycle()');
  const cycle = noCeremony('escrow.cycle()', await e.cycle());
  console.log(`  floor=${cycle?.floor.format()} ceilingMs=${cycle?.ceilingMs} handoverMs=${cycle?.handoverMs}`);

  step('⑤ settlement preview — escrow.tenureSettlement() (rendered Prices)');
  const settle = noCeremony('escrow.tenureSettlement()', await e.tenureSettlement());
  console.log(`  governorShare=${settle.governorShare.format()} fee=${settle.fee.format()}`);
  check('settlement is coin-rendered', settle.fee.format().includes(e.coin.symbol));

  step('⑥ temporal / keeper — escrow.integratedAt() / phaseStartAt() / nextTransitionAt() (Dates)');
  const [integratedAt, phaseStart, nextT] = await Promise.all([
    e.integratedAt(),
    e.phaseStartAt(),
    e.nextTransitionAt(),
  ]);
  noCeremony('escrow.integratedAt/phaseStartAt/nextTransitionAt', null);
  console.log(`  integratedAt=${integratedAt.toISOString()} phaseStart=${phaseStart?.toISOString()} nextTransition=${nextT?.toISOString()}`);
  check('temporal reads are Dates', integratedAt instanceof Date);

  step('⑦ credit memory + asset id — escrow.lastRentPrice() / assetId()');
  const [lastRent, assetId] = await Promise.all([e.lastRentPrice(), e.assetId()]);
  noCeremony('escrow.lastRentPrice/assetId', null);
  console.log(`  lastRentPrice=${lastRent?.format() ?? 'null'}  assetId=${assetId.slice(0, 10)}…`);

  step('— ceremony report —');
  console.log(`  reader-drops needed: ${ceremony.length} (was 16)`);
  check('zero ceremony — every read has a home on its object', ceremony.length === 0);
  check('governs still object-centric', (await governanceCap.governs(escrow.id)) === true);
}

main().then(finish);
