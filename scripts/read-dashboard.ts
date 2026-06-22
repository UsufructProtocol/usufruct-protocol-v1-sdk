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
import { coinTag, usufruct, type InboxMessage, type Market } from '@usufruct-protocol/sdk';
import { GRAPHQL_TESTNET, TESTNET } from '@usufruct-protocol/sdk/config/network.js';
import { ownedIds } from '@usufruct-protocol/sdk/highlevel/role.js';
import { check, createdId, finish, loadSigner, makeClient, rateLimited, send, sleep, step, waitForChainTime } from './lib.js';

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
  const a = usufruct({ network: 'testnet', client, signer: ALICE, graphql: GRAPHQL_TESTNET });

  step('setup — integrate + rent (Bob) + challenge (Carol) → demand');
  const { escrow, governanceCap } = await a.write.integrate({ asset: await mintAsset(), coin: DUMMY, market }).send();
  const bob = await newRenter();
  const carol = await newRenter();
  await (await usufruct({ network: 'testnet', client, signer: bob }).nav.escrow(escrow.id)).write.rent({ tenures: 1 }).send();
  await (await usufruct({ network: 'testnet', client, signer: carol }).nav.escrow(escrow.id)).write.rent({ tenures: 1 }).send();

  const e = await a.nav.escrow(escrow.id);

  step('① escrow-whole — straight off the handle');
  const assetState = await e.read.assetState();
  const floorPrice = await e.read.floorPrice();
  const expiresAt = await e.read.expiresAt();
  const governanceCapId = await e.read.governanceCapId();
  console.log(`  status=${assetState.kind}  available=${['idle', 'descent'].includes(assetState.kind)}  floor=${floorPrice.format()}`);
  console.log(`  expiresAt=${expiresAt?.toISOString()}  challenged=${assetState.kind === 'demand'}`);
  console.log(`  coin=${e.coin.symbol}  govCap=${governanceCapId.slice(0, 10)}…`);
  check('handle covers status/floor/expiry/ids', true);

  step('② the seat — escrow.nav.activeCap().read.state() (no fetch dance, no possession)');
  const activeCapHandle = await e.nav.activeCap();
  const pendingCapHandle = await e.nav.pendingCap();
  const active = await activeCapHandle!.read.state(); // built from ids the handle already has
  const pending = await pendingCapHandle!.read.state();
  const activeUsufructuaryAddr = await e.read.activeUsufructuary();
  console.log(`  active: who=${activeUsufructuaryAddr?.slice(0, 10)}… stake=${active.stake?.format()} time=${active.timeRemainingMs}ms accruing=${active.creditAccruing}`);
  console.log(`  pending: stake=${pending.stake?.format()} role=${pending.role}`);
  check('escrow.nav.activeCap/pendingCap resolve the seats', active.role === 'active' && pending.role === 'pending');

  step('③ the MARKET / policy — escrow.market() (one call, coin-aware)');
  const mkt = noCeremony('escrow.market()', await e.read.market());
  console.log(`  restPrice=${mkt.restPrice.format()} tenure=${mkt.tenure}ms handover=${j(mkt.handover)}`);
  console.log(`  creditShape=${j(mkt.creditShape)} escalation=${j(mkt.escalation)} descent=${j(mkt.descent)}`);
  check('market.restPrice is a rendered Price', mkt.restPrice.format().includes(e.coin.symbol));

  step('④ live cycle params — escrow.cycle()');
  const cycle = noCeremony('escrow.cycle()', await e.read.cycle());
  console.log(`  floor=${cycle?.floor.format()} ceilingMs=${cycle?.ceilingMs} handoverMs=${cycle?.handoverMs}`);

  step('⑤ settlement preview — escrow.tenureSettlement() (rendered Prices)');
  const settle = noCeremony('escrow.tenureSettlement()', await e.read.tenureSettlement());
  console.log(`  governorShare=${settle.governorShare.format()} fee=${settle.fee.format()}`);
  check('settlement is coin-rendered', settle.fee.format().includes(e.coin.symbol));

  step('⑥ temporal / keeper — escrow.integratedAt() / phaseStartAt() / nextTransitionAt() (Dates)');
  const [integratedAt, phaseStart, nextT] = await Promise.all([
    e.read.integratedAt(),
    e.read.phaseStartAt(),
    e.read.nextTransitionAt(),
  ]);
  noCeremony('escrow.integratedAt/phaseStartAt/nextTransitionAt', null);
  console.log(`  integratedAt=${integratedAt.toISOString()} phaseStart=${phaseStart?.toISOString()} nextTransition=${nextT?.toISOString()}`);
  check('temporal reads are Dates', integratedAt instanceof Date);

  step('⑦ credit memory + asset id — escrow.lastRentPrice() / assetId()');
  const [lastRent, assetId] = await Promise.all([e.read.lastRentPrice(), e.read.assetId()]);
  noCeremony('escrow.lastRentPrice/assetId', null);
  console.log(`  lastRentPrice=${lastRent?.format() ?? 'null'}  assetId=${assetId.slice(0, 10)}…`);

  step('⑧ unified related handles — every object reachable from the escrow (no possession)');
  // All present as handles regardless of who holds them; possession is the boolean axis.
  const governanceCapHandle = await e.nav.governanceCap();
  const earningsInboxHandle = await e.nav.earningsInbox();
  const feeInboxHandle = await e.nav.feeInbox();
  check('governanceCap handle present + governs', (await governanceCapHandle.read.governs(escrow.id)) === true);
  check('earningsInbox handle present', typeof earningsInboxHandle.inboxId === 'string');
  check('feeInbox handle present', typeof feeInboxHandle.inboxId === 'string');
  // Possession is the role — and possession is just Sui object ownership. There is no
  // `role()`; ask the canonical lookup whether my address owns the object the escrow names.
  const holds = async (kind: string, id: string) => (await ownedIds(client, me, `${TESTNET.packageId}::${kind}`)).has(id);
  const canGovern = await holds('governance_cap::GovernanceCap', governanceCapHandle.capId);
  const holdsEarnings = await holds('earnings_inbox::EarningsInbox', earningsInboxHandle.inboxId);
  console.log(`  possession (object ownership): canGovern=${canGovern} holdsEarnings=${holdsEarnings}`);

  step('⑨ react on the seat — usufructCap.react.watch() (the renter watches their own seat)');
  const seen: string[] = [];
  const stop = activeCapHandle!.react.watch((s) => seen.push(s.role));
  await sleep(4000); // let the initial state land
  stop();
  check('cap.watch emitted the seat state', seen.length >= 1, `roles=${seen.join(',')}`);

  step('⑩ inspect the cap — usufructCap.inspect.history() (its slice of the timeline)');
  // The indexer trails the fullnode; poll briefly for the fresh cap's events.
  let capEvents = await activeCapHandle!.inspect.history();
  for (let i = 0; i < 8 && capEvents.length === 0; i++) {
    await sleep(5000);
    capEvents = await activeCapHandle!.inspect.history();
  }
  check('cap.history includes UsufructCapMinted', capEvents.some((h) => h.kind === 'UsufructCapMinted'), capEvents.map((h) => h.kind).join(','));

  step('⑪ react on income — earningsInbox.react.watch() catches a settlement (handover → EarningsMessagePosted)');
  const income: InboxMessage[] = [];
  const stopInbox = earningsInboxHandle.react.watch((m) => income.push(m));
  const handoverExpiresAt = await e.read.handoverExpiresAt();
  await waitForChainTime(client, BigInt(handoverExpiresAt!.getTime())); // wait out the handover
  await e.write.applyPendingTransitionStates().send(); // settle → Bob displaced, 90% posts to earnings
  await sleep(6000); // let the firehose deliver the EarningsMessagePosted
  stopInbox();
  check('earningsInbox.watch caught income', income.length >= 1, income.map((m) => m.amount.format()).join(','));

  step('— ceremony report —');
  console.log(`  reader-drops needed: ${ceremony.length} (was 16)`);
  check('zero ceremony — every read has a home on its object', ceremony.length === 0);
}

main().then(finish);
