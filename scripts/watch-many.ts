/**
 * Portfolio watch (P1 #5) — `u.watchMany` / `governanceCap.watch` over ONE gRPC
 * firehose. Proves the high-level door end-to-end on testnet:
 *
 *   ① INTEGRATE A, then B into the SAME GovernanceCap (one portfolio)
 *   ② WATCH    u.watchMany([A,B]) → two initials, tagged by id
 *   ③ MUTATE A (updateMarket) → exactly one update, for A
 *   ④ ADD C    watch.add(C) in flight → C's initial arrives
 *   ⑤ MUTATE B → an update for B
 *   ⑥ REMOVE A → mutate A → silence (no A update)
 *   ⑦ STOP     → no further callbacks
 *   ⑧ PORTFOLIO governanceCap.watch() discovers the portfolio and watches it
 *
 * Writes (integrate + updateMarket) need a funded signer. Reclaim escrows after
 * with `npm run clean`. Run: `npm run watch:many`.
 */
import { Transaction } from '@mysten/sui/transactions';
import { coinTag, usufruct, type Escrow, type Market } from '@usufruct-protocol/sdk';
import { GRAPHQL_TESTNET } from '@usufruct-protocol/sdk/config/network.js';
import { check, finish, loadSigner, makeClient, rateLimited, send, sleep, step } from './lib.js';

const DUMMY_PKG = '0xa72e830fcb3e688ab3c20ff3cbd0a149cd1b58715709905585e75eb18317a52a';
const DUMMY_COIN_PKG = '0x97fb7c77162e3edf6a44815ec9eb29b69f9a43747dfb1c1019a7fc5501e2ad96';
const DUMMY = coinTag({ type: `${DUMMY_COIN_PKG}::dummy_coin::DUMMY_COIN`, decimals: 9, symbol: 'DUMMY' });

const raw = rateLimited(makeClient());
const ALICE = loadSigner();
const me = ALICE.toSuiAddress();

const market = (rest: number): Market => ({
  restPrice: DUMMY(rest),
  tenure: '5m',
  multiTenure: false,
  creditShape: 'linear',
  auctionShape: 'linear',
  descent: 'off',
  handover: '15s',
  escalation: { fixed: DUMMY(0.001) },
  retireCommitment: 'immediate',
  ensembleCommitment: 'immediate',
});

async function mintAsset(): Promise<string> {
  const tx = new Transaction();
  tx.transferObjects([tx.moveCall({ target: `${DUMMY_PKG}::dummy_asset::mint` })], me);
  const res = await send(raw, tx, ALICE);
  for (const ch of res.effects?.changedObjects ?? []) {
    if (ch.idOperation === 'Created' && res.objectTypes?.[ch.objectId]?.includes('::dummy_asset::DummyAsset')) {
      return ch.objectId;
    }
  }
  throw new Error('no DummyAsset created');
}

// ── a small awaiter over the watch callback ──
interface Tick {
  id: string;
  status: string;
  n: number;
}

async function main(): Promise<void> {
  const u = usufruct({ network: 'testnet', signer: ALICE, graphql: GRAPHQL_TESTNET });

  step('① integrate A, then B into the same GovernanceCap');
  const { escrow: a, governanceCap: gov, earningsInbox } = await u.write.integrate({
    asset: await mintAsset(),
    coin: DUMMY,
    market: market(0.01),
  }).send();
  const b = await gov.write.integrateIntoPortfolio(await mintAsset(), DUMMY, market(0.01), {
    earningsInbox: earningsInbox.inboxId,
  }).send();
  console.log(`  A=${a.id.slice(0, 10)}…  B=${b.id.slice(0, 10)}…  cap=${gov.capId.slice(0, 10)}…`);

  // watch wiring
  const ticks: Tick[] = [];
  const claimed = new Set<number>();
  const waiters: Array<() => void> = [];
  let seq = 0;
  const onChange = async (e: Escrow) => {
    ticks.push({ id: e.id, status: (await e.read.assetState()).kind, n: ++seq });
    for (const w of [...waiters]) w();
  };
  const find = (pred: (t: Tick) => boolean): Tick | undefined =>
    ticks.find((t) => !claimed.has(t.n) && pred(t));
  const nextUpdate = (pred: (t: Tick) => boolean, timeoutMs = 45_000): Promise<Tick> =>
    new Promise((resolve, reject) => {
      const tryMatch = (): boolean => {
        const m = find(pred);
        if (m) {
          claimed.add(m.n);
          resolve(m);
          return true;
        }
        return false;
      };
      if (tryMatch()) return;
      const onTick = (): void => {
        if (tryMatch()) {
          clearTimeout(timer);
          const i = waiters.indexOf(onTick);
          if (i >= 0) waiters.splice(i, 1);
        }
      };
      const timer = setTimeout(() => {
        const i = waiters.indexOf(onTick);
        if (i >= 0) waiters.splice(i, 1);
        reject(new Error('timeout waiting for a matching update'));
      }, timeoutMs);
      waiters.push(onTick);
    });

  step('② u.watchMany([A,B]) — expect two initials, tagged by id');
  const watch = u.react.watchMany([a.id, b.id], onChange);
  try {
    await nextUpdate((t) => t.id === a.id);
    await nextUpdate((t) => t.id === b.id);
    check('both initials arrived (A and B), tagged by id', true);

    step('③ mutate A (updateMarket) — expect one update for A');
    await gov.write.updateMarket(a.id, { restPrice: DUMMY(0.02) }).send();
    const ua = await nextUpdate((t) => t.id === a.id);
    check('A change pushed over the firehose', ua.id === a.id);

    step('④ add C in flight — expect C initial');
    const c = await gov.write.integrateIntoPortfolio(await mintAsset(), DUMMY, market(0.01), {
      earningsInbox: earningsInbox.inboxId,
    }).send();
    watch.add(c.id);
    const ic = await nextUpdate((t) => t.id === c.id);
    check('added escrow C emits its initial', ic.id === c.id);

    step('⑤ mutate B — expect an update for B');
    await gov.write.updateMarket(b.id, { restPrice: DUMMY(0.02) }).send();
    const ub = await nextUpdate((t) => t.id === b.id);
    check('B change pushed', ub.id === b.id);

    step('⑥ remove A, mutate A — expect silence for A');
    watch.remove(a.id);
    const aBefore = ticks.filter((t) => t.id === a.id).length;
    await gov.write.updateMarket(a.id, { restPrice: DUMMY(0.03) }).send();
    await sleep(10_000);
    const aAfter = ticks.filter((t) => t.id === a.id).length;
    check('no A update after remove()', aAfter === aBefore, `${aBefore}→${aAfter}`);

    step('⑦ stop — expect no further callbacks');
    watch.stop();
    const total = ticks.length;
    await gov.write.updateMarket(b.id, { restPrice: DUMMY(0.04) }).send();
    await sleep(8_000);
    check('no callbacks after stop()', ticks.length === total, `${total}→${ticks.length}`);
  } finally {
    watch.stop();
  }

  step('⑧ governanceCap.watch() — discover the portfolio and watch it (one firehose)');
  // The indexer trails the fullnode; poll discovery until it sees the portfolio.
  let portfolio: string[] = [];
  for (let i = 0; i < 12 && portfolio.length < 2; i++) {
    portfolio = (await gov.inspect.escrows()).map((l) => l.escrowId);
    if (portfolio.length < 2) await sleep(5_000);
  }
  check('discovery found the portfolio (≥2 escrows)', portfolio.length >= 2, `found ${portfolio.length}`);
  if (portfolio.length >= 2) {
    const seen = new Set<string>();
    const pWatch = await gov.react.watch((e) => seen.add(e.id));
    // initials for the whole portfolio should arrive
    for (let i = 0; i < 12 && seen.size < 2; i++) await sleep(2_000);
    check('governanceCap.watch() emitted portfolio initials', seen.size >= 2, `initials ${seen.size}`);
    pWatch.stop();
  }
}

main().then(finish);
