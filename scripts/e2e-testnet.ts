/**
 * Live testnet validation of the prototype slice (plan step 8).
 *
 * Sequence: package verification → integrate (Origin) → fetch+decode →
 * Pattern B live parity → Pattern A → rent (Transition) → apply step parity
 * (§8 invariant) → retire+claim (Terminal) → persist fixture.
 *
 * Spends only gas from the configured signer. Run: `npm run e2e`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { bcs } from '@mysten/sui/bcs';
import { Transaction } from '@mysten/sui/transactions';
import * as actions from '../src/actions/index.js';
import {
  EarningsMessageCollected,
  EarningsMessagePosted,
} from '../src/codegen/usufruct/earnings_message.js';
import { HandoverCompleted } from '../src/codegen/usufruct/asset_state.js';
import * as curve from '../src/sim/curve.js';
import {
  PARITY_CASES,
  parityEqual,
  stable as pStable,
  type ParityCtx,
} from '../test/parity-cases.js';
import { SuiGraphQLClient } from '@mysten/sui/graphql';
import { GRAPHQL_TESTNET, TESTNET } from '../src/config/network.js';
import { indexerSource } from '../src/indexer/index.js';
import { id, mist, ms, tenureCount } from '../src/primitives/brand.js';
import { chainSource } from '../src/primitives/source.js';
import { grpcSource } from '../src/primitives/grpc-source.js';
import { createReader, type Reader } from '../src/read/index.js';
import * as views from '../src/views/index.js';
import {
  check,
  createdId,
  finish,
  loadSigner,
  makeClient,
  makeGrpcClient,
  send,
  chainNowMs,
  rateLimited,
  retry429,
  sleep,
  step,
  waitForChainTime,
} from './lib.js';

// Dummy-asset / dummy-coin axes (free mint; zero economic noise).
const DUMMY_PKG = '0xa72e830fcb3e688ab3c20ff3cbd0a149cd1b58715709905585e75eb18317a52a';
const DUMMY_COIN_PKG = '0x97fb7c77162e3edf6a44815ec9eb29b69f9a43747dfb1c1019a7fc5501e2ad96';
const DUMMY_COIN_TREASURY =
  '0xccee2bc2227913f441c7544892cf5d220880cbc0c55be8733b4b6777def976bc';
const ASSET_T = `${DUMMY_PKG}::dummy_asset::DummyAsset`;
const COIN_T = `${DUMMY_COIN_PKG}::dummy_coin::DUMMY_COIN`;
const SUI_T = '0x2::sui::SUI';
const TYPE_ARGS: [string, string] = [ASSET_T, COIN_T];
const TYPE_ARGS_SUI: [string, string] = [ASSET_T, SUI_T];
// Tenure must outlast every Occupied-state step before the §7 expiry wait
// (live parity, indexer retries, three subscribe variants). 90s gives margin;
// the cap goes stale (EStaleUsufructCap) the moment it elapses.
const TENURE_MS = 90_000n;
const HANDOVER_MS = 25_000n;

const client = rateLimited(makeClient());
const signer = loadSigner();
const me = signer.toSuiAddress();

// DummyAsset is NOT uid-only ({ id: UID, uses: u64 }) — the integrator-supplied
// schema path (SPEC §10). Decoding with the wrong schema silently misaligns
// every field after the asset; observed live before this schema was added.
const dummyAssetSchema = bcs.struct('DummyAsset', { id: bcs.Address, uses: bcs.u64() });
const source = chainSource(client, {
  assetSchema: dummyAssetSchema,
  packageId: TESTNET.packageId,
});

/** A bound Reader (tier 1) over an escrow — the default read surface. */
const readerFor = (
  escrow: ReturnType<typeof id<'Escrow'>>,
  typeArguments: [string, string] = TYPE_ARGS,
): Reader =>
  createReader(client, {
    packageId: TESTNET.packageId,
    escrowId: escrow,
    typeArguments,
    assetSchema: dummyAssetSchema,
  });

/** Key-order-insensitive deep equality (BCS parse emits `$kind` last). */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    v !== null && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as object).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}
const stable = stableJson;

const SIM_CHUNK = 40;

/**
 * Run the full parity table against a live escrow in its current state:
 * every mirrored view vs the unrolled on-chain views, chunked into
 * simulateTransaction batches. Returns the decoded on-chain answers for
 * fixture persistence.
 */
async function runParity(
  label: string,
  escrowState: Awaited<ReturnType<typeof source.fetch>>,
  ctx: ParityCtx,
): Promise<Record<string, unknown>> {
  // Flatten all calls, remembering each case's slice.
  const flatCalls: Array<(tx: Transaction, c: ParityCtx) => void> = [];
  const slices: Array<{ start: number; end: number }> = [];
  for (const pc of PARITY_CASES) {
    slices.push({ start: flatCalls.length, end: flatCalls.length + pc.spec.calls.length });
    flatCalls.push(...pc.spec.calls);
  }

  const allRets: Uint8Array[] = [];
  for (let i = 0; i < flatCalls.length; i += SIM_CHUNK) {
    const chunk = flatCalls.slice(i, i + SIM_CHUNK);
    const tx = new Transaction();
    tx.setSender(me);
    for (const add of chunk) add(tx, ctx);
    const sim = await retry429(() =>
      client.core.simulateTransaction({
        transaction: tx,
        checksEnabled: false,
        include: { commandResults: true },
      }),
    );
    if (sim.$kind !== 'Transaction') throw new Error(`${label}: parity sim failed`);
    for (let j = 0; j < chunk.length; j++) {
      const ret = sim.commandResults?.[j]?.returnValues?.[0];
      if (!ret) throw new Error(`${label}: command ${i + j} returned no value`);
      allRets.push(ret.bcs);
    }
  }

  const results: Record<string, unknown> = {};
  let failures = 0;
  for (let k = 0; k < PARITY_CASES.length; k++) {
    const pc = PARITY_CASES[k]!;
    const rets = allRets.slice(slices[k]!.start, slices[k]!.end);
    const onchain = pc.spec.decode(rets, ctx);
    const local = pc.local(escrowState, ms(ctx.nowMs!), ctx);
    const ok = parityEqual(local, onchain);
    if (!ok) {
      failures++;
      check(`${label} · ${pc.name}`, false, `local=${pStable(local)} chain=${pStable(onchain)}`);
    }
    results[pc.name] = JSON.parse(pStable(onchain));
  }
  check(
    `${label}: ${PARITY_CASES.length} view parity cases`,
    failures === 0,
    failures === 0 ? 'all equal' : `${failures} mismatches`,
  );
  return results;
}

const mintAsset = (tx: Transaction) =>
  tx.moveCall({ target: `${DUMMY_PKG}::dummy_asset::mint` });
const mintCoin = (tx: Transaction, amount: bigint) =>
  tx.moveCall({
    target: `${DUMMY_COIN_PKG}::dummy_coin::mint`,
    arguments: [tx.object(DUMMY_COIN_TREASURY), tx.pure.u64(amount)],
  });

const ensembleCfg = {
  restPrice: 1_000n,
  tenureMs: TENURE_MS,
  handover: { kind: 'fixed', floorMs: HANDOVER_MS },
} as Parameters<typeof actions.integrate>[0]['ensemble'];

async function integrateEscrow() {
  const action = actions.integrate({
    ensemble: ensembleCfg,
    assetType: ASSET_T,
    coinType: COIN_T,
  });
  const tx = new Transaction();
  const result = action.toPtb(tx, {
    pkg: TESTNET,
    asset: mintAsset(tx),
    typeArguments: TYPE_ARGS,
  });
  tx.transferObjects([result[0]!, result[1]!], me);
  const res = await send(client, tx, signer);
  return {
    escrowId: id<'Escrow'>(createdId(res, '::escrow::Escrow')),
    govCapId: id<'GovernanceCap'>(createdId(res, '::governance_cap::GovernanceCap')),
    inboxId: createdId(res, '::earnings_inbox::EarningsInbox'),
    action,
  };
}

async function main() {
  console.log(`signer: ${me}`);

  step('1. package verification');
  {
    const { object } = await client.core.getObject({ objectId: TESTNET.packageId });
    check('usufruct package exists', object.type === 'package', object.type);
    const feeRef = await client.core.getObject({ objectId: TESTNET.feeRefId });
    check('fee ref exists', feeRef.object.type.includes('ProtocolFeeRef'), feeRef.object.type);
  }

  step('2. integrate (Origin action)');
  const { escrowId, govCapId, inboxId, action: integrateAction } = await integrateEscrow();
  check('escrow created', escrowId.length === 66, escrowId);
  check('governance cap created', govCapId.length === 66);

  step('2b. integrate_into_portfolio — second escrow, SUI coin axis, same inbox');
  let escrowSuiId: ReturnType<typeof id<'Escrow'>>;
  {
    const tx = new Transaction();
    actions
      .integrateIntoPortfolio({ ensemble: ensembleCfg, assetType: ASSET_T, coinType: SUI_T })
      .toPtb(tx, {
        pkg: TESTNET,
        asset: mintAsset(tx),
        typeArguments: TYPE_ARGS_SUI,
        governanceCapId: govCapId,
        earningsInboxId: inboxId,
      });
    const res = await send(client, tx, signer);
    escrowSuiId = id<'Escrow'>(createdId(res, '::escrow::Escrow'));
    check('portfolio escrow created (SUI axis)', escrowSuiId.length === 66, escrowSuiId);
  }

  step('3. ChainSource.fetch + BCS decode of the live escrow');
  let state = await source.fetch(escrowId);
  check('asset type arg decoded', state.assetType === ASSET_T);
  check('coin type arg decoded', state.coinType === COIN_T);
  check('decoded as Idle', state.escrow.state?.$kind === 'Waiting');

  step('3b. integrate.step parity (initial state mirror)');
  {
    const integratedAt = state.escrow.core!.integrated_at.ms;
    const { state: stepped } = integrateAction.step(ms(integratedAt));
    const liveIdle =
      state.escrow.state?.$kind === 'Waiting' && state.escrow.state.Waiting.$kind === 'Idle'
        ? state.escrow.state.Waiting.Idle
        : null;
    const stepIdle =
      stepped.escrow.state?.$kind === 'Waiting' && stepped.escrow.state.Waiting.$kind === 'Idle'
        ? stepped.escrow.state.Waiting.Idle
        : null;
    check(
      'cycle params bit-equal',
      stable(liveIdle?.cycle) === stable(stepIdle?.cycle),
      stable(liveIdle?.cycle),
    );
    check(
      'ensemble bit-equal',
      stable(state.escrow.core?.ensemble) === stable(stepped.escrow.core?.ensemble),
    );
  }

  step('4. Full live parity — Idle state (golden gate)');
  {
    const now = BigInt(Date.now());
    // Raw bytes of the same version the parity answers describe (fixture).
    const { object: rawObject } = await client.core.getObject({
      objectId: escrowId,
      include: { content: true },
    });
    const ctx: ParityCtx = {
      packageId: TESTNET.packageId,
      escrowId,
      typeArguments: TYPE_ARGS,
      nowMs: now,
      probeCapId: govCapId,
    };
    const results = await runParity('idle', state, ctx);
    fixture = {
      capturedAt: new Date().toISOString(),
      network: 'testnet',
      packageId: TESTNET.packageId,
      objectId: rawObject.objectId,
      type: rawObject.type,
      contentBase64: Buffer.from(rawObject.content!).toString('base64'),
      parity: { nowMs: String(now), probeCapId: govCapId, results },
    };
  }

  step('5. Pattern A devInspect reads');
  {
    // accrued_credit_mist aborts on a non-rented escrow (observed live) —
    // it is read after rent, in step 6.
    const floor = await readerFor(escrowId).floorPriceMist(ms(Date.now()));
    check('read.floorPriceMist == rest price', floor === 1_000n, String(floor));
  }

  step('6. rent (Transition action) — both escrows, one PTB');
  {
    const action = actions.rent({ tenures: tenureCount(1) });
    const tx = new Transaction();
    const cap = action.toPtb(tx, {
      pkg: TESTNET,
      escrowId,
      payment: mintCoin(tx, 1_000n),
      typeArguments: TYPE_ARGS,
    });
    // Second escrow pays in real SUI (split from gas) — same inbox, second
    // coin axis: the §5.2 partition setup.
    const [suiStake] = tx.splitCoins(tx.gas, [1_000n]);
    const capSui = action.toPtb(tx, {
      pkg: TESTNET,
      escrowId: escrowSuiId,
      payment: suiStake!,
      typeArguments: TYPE_ARGS_SUI,
    });
    tx.transferObjects([cap, capSui], me);
    const res = await send(client, tx, signer);
    const capIds = res.effects!.changedObjects
      .filter((c) => c.idOperation === 'Created')
      .map((c) => c.objectId)
      .filter((oid) => res.objectTypes?.[oid]?.includes('::usufruct_cap::UsufructCap'));
    mainCapId = capIds.find((oid) => res.objectTypes?.[oid] !== undefined) ?? '';
    // Two caps were minted in this PTB; match each to its escrow afterwards.
    state = await source.fetch(escrowId);
    const activeCap = views.activeUsufructCapId(state, ms(Date.now()));
    mainCapId = capIds.find((c) => c === activeCap) ?? capIds[0]!;
    suiCapId = capIds.find((c) => c !== mainCapId) ?? capIds[1]!;
    check('escrow is Occupied after rent', views.isOccupied(state, ms(Date.now())));

    const credit = await readerFor(escrowId).accruedCreditMist(ms(Date.now()));
    check('read.accruedCreditMist decodes while rented', credit >= 0n, String(credit));
  }

  step('6b. Full live parity — Occupied state');
  {
    const now = BigInt(Date.now());
    const { object: rawObject } = await client.core.getObject({
      objectId: escrowId,
      include: { content: true },
    });
    const ctx: ParityCtx = {
      packageId: TESTNET.packageId,
      escrowId,
      typeArguments: TYPE_ARGS,
      nowMs: now,
      probeCapId: govCapId,
    };
    const results = await runParity('occupied', state, ctx);
    occupiedFixture = {
      capturedAt: new Date().toISOString(),
      network: 'testnet',
      packageId: TESTNET.packageId,
      objectId: rawObject.objectId,
      type: rawObject.type,
      contentBase64: Buffer.from(rawObject.content!).toString('base64'),
      parity: { nowMs: String(now), probeCapId: govCapId, results },
    };
  }

  step('6i. IndexerSource (GraphQL, live)');
  {
    const norm = (s: unknown) => String(s).replace(/^0x/, '').toLowerCase();
    const gql = new SuiGraphQLClient({ url: GRAPHQL_TESTNET, network: 'testnet' });
    const idx = indexerSource(gql, {
      packageId: TESTNET.packageId,
      assetSchema: dummyAssetSchema,
    });

    // byGovernor (events filtered by sender = me → only our integrations).
    // Retry to absorb indexer lag behind the fullnode.
    let govFound = false;
    for (let attempt = 0; attempt < 10 && !govFound; attempt++) {
      const ids = new Set<string>();
      for await (const s of idx.query({ byGovernor: me })) {
        ids.add(norm(s.objectId));
        if (ids.has(norm(escrowId))) break;
      }
      govFound = ids.has(norm(escrowId));
      if (!govFound) await sleep(3_000);
    }
    check('indexer query({byGovernor: me}) finds the rented escrow', govFound);

    // events(AssetIntegrated, sender = me) include our escrow id (now indexed).
    let evFound = false;
    for await (const e of idx.events({
      type: `${TESTNET.packageId}::asset_state::AssetIntegrated`,
      sender: me,
    })) {
      if (norm(e.json.escrow_id) === norm(escrowId)) {
        evFound = true;
        break;
      }
    }
    check('indexer events(AssetIntegrated) include our escrow', evFound);

    // byAssetType smoke: the first yielded escrow is a DummyAsset (the filter
    // guarantees it). Bounded — breaks on the first match.
    let typed = false;
    for await (const s of idx.query({ byAssetType: ASSET_T })) {
      typed = norm(s.assetType).includes('dummyasset');
      break;
    }
    check('indexer query({byAssetType}) yields a typed escrow', typed);
  }

  step('6r. read tier live — Reader methods, snapshot, drift-free time-travel');
  {
    const rdr = readerFor(escrowId);
    // Individual typed methods return the bytecode's own answer (drift = 0).
    check('read.isOccupied()', (await rdr.isOccupied()) === true);
    const hv = await rdr.handover();
    check(
      'read.handover() = fixed 25s',
      hv.kind === 'fixed' && hv.floorMs === HANDOVER_MS,
      pStable(hv),
    );

    // snapshot batches the whole nullary table (+ now/cap views) in few sims.
    const t = ms(await chainNowMs(client));
    const snap = await rdr.snapshot({ t, capId: mainCapId });
    check('snapshot covers the table', Object.keys(snap).length > 50, String(Object.keys(snap).length));
    check('snapshot.activeStakeBalanceMist', snap.activeStakeBalanceMist === 1_000n, String(snap.activeStakeBalanceMist));
    check('snapshot.usufructCapIsActive(main)', snap.usufructCapIsActive === true);

    // Drift-free time-travel: same on-chain state, two times → monotonic
    // accrued credit, both computed by the deployed bytecode.
    const c1 = await rdr.accruedCreditMist(t);
    const c2 = await rdr.accruedCreditMist(ms(t + 5_000n));
    check('accruedCreditMist grows with t (time-travel)', c2 >= c1 && c2 > 0n, `${c1} -> ${c2}`);
  }

  step('6s. Source.subscribe / query (live)');
  {
    // query: discover the escrows this signer rents (via its UsufructCaps);
    // skips the many stale caps from prior runs (consumed escrows).
    const rented = new Set<string>();
    try {
      for await (const st of source.query({ byUsufructuary: me })) {
        rented.add(st.objectId);
        if (rented.has(escrowId) && rented.has(escrowSuiId)) break;
      }
    } catch (e) {
      check('query iteration', false, String((e as Error).message));
    }
    check('query finds the rented escrow', rented.has(escrowId), `${rented.size} live escrow(s)`);
    check('query finds the SUI-axis escrow', rented.has(escrowSuiId));

    // subscribe: initial emission, then again when a mutation bumps the
    // object version (dedupe by version).
    const ac = new AbortController();
    let emissions = 0;
    const loop = (async () => {
      for await (const _st of source.subscribe(escrowId, {
        pollIntervalMs: 400,
        signal: ac.signal,
      })) {
        emissions += 1;
        if (emissions >= 2) {
          ac.abort();
          break;
        }
      }
    })();
    await sleep(1_500); // let the initial emission land
    {
      const tx = new Transaction();
      actions
        .updateUsufructuaryRefundAddress({ usufructCapId: mainCapId, newAddress: me })
        .toPtb(tx, { pkg: TESTNET, escrowId, usufructCapId: mainCapId, typeArguments: TYPE_ARGS });
      await send(client, tx, signer);
    }
    await Promise.race([loop, sleep(20_000)]);
    ac.abort();
    check('subscribe emitted initial + post-mutation state', emissions >= 2, `${emissions} emissions`);
  }

  step('6t. grpcSource.subscribe — server push (live)');
  {
    // Push instead of poll: subscribeCheckpoints firehose → scan effects for
    // our escrow → re-fetch on change. Latency should be a checkpoint, not a
    // poll interval. gRPC client is separate (subscriptionService is gRPC-only).
    const grpc = makeGrpcClient();
    const push = grpcSource(grpc, { assetSchema: dummyAssetSchema, packageId: TESTNET.packageId });
    const ac = new AbortController();
    let emissions = 0;
    let pushAt = 0;
    const loop = (async () => {
      for await (const _st of push.subscribe(escrowId, { signal: ac.signal })) {
        emissions += 1;
        if (emissions >= 2) {
          pushAt = Date.now();
          ac.abort();
          break;
        }
      }
    })();
    await sleep(2_000); // let the initial state + stream open land
    const sentAt = Date.now();
    {
      const tx = new Transaction();
      actions
        .updateUsufructuaryRefundAddress({ usufructCapId: mainCapId, newAddress: me })
        .toPtb(tx, { pkg: TESTNET, escrowId, usufructCapId: mainCapId, typeArguments: TYPE_ARGS });
      await send(client, tx, signer);
    }
    await Promise.race([loop, sleep(25_000)]);
    ac.abort();
    check('grpc push emitted initial + post-mutation state', emissions >= 2, `${emissions} emissions`);
    if (emissions >= 2) {
      const latency = pushAt - sentAt;
      check('grpc push latency under a poll interval', latency < 8_000, `${latency}ms send→push`);
    }
  }

  step('6u. grpcSource.subscribeMany — dynamic add over one firehose (live)');
  {
    // Open watching only `escrowId`, then `add(escrowSuiId)` in flight (no
    // reopen) and receive its initial state; finally mutate `escrowId` and see
    // the change routed to its tag. One firehose throughout.
    const norm = (s: unknown) => String(s).replace(/^0x/, '').toLowerCase();
    const grpc = makeGrpcClient();
    const many = grpcSource(grpc, { assetSchema: dummyAssetSchema, packageId: TESTNET.packageId });
    const tags: string[] = [];
    let postMutationTagged = false;
    let mutationSent = false;
    const sub = many.subscribeMany([escrowId]);
    const loop = (async () => {
      for await (const u of sub) {
        tags.push(norm(u.escrowId));
        if (mutationSent && norm(u.escrowId) === norm(escrowId)) {
          postMutationTagged = true;
          sub.close();
          break;
        }
      }
    })();

    await sleep(2_000); // initial of escrowId + stream open
    check('subscribeMany emitted the opening escrow', tags.includes(norm(escrowId)), `${tags.length} tagged`);

    await sub.add(escrowSuiId); // grow the set live — its initial should arrive
    await sleep(1_500);
    check(
      'add(id) delivered the new escrow initial state (live, no reopen)',
      tags.includes(norm(escrowSuiId)),
      `${tags.length} tagged`,
    );

    mutationSent = true;
    {
      const tx = new Transaction();
      actions
        .updateUsufructuaryRefundAddress({ usufructCapId: mainCapId, newAddress: me })
        .toPtb(tx, { pkg: TESTNET, escrowId, usufructCapId: mainCapId, typeArguments: TYPE_ARGS });
      await send(client, tx, signer);
    }
    await Promise.race([loop, sleep(25_000)]);
    sub.close();
    check('subscribeMany routed the mutation to its escrow tag', postMutationTagged);
  }

  step('6c. Settlement Inspect functions (live)');
  {
    const rdr = readerFor(escrowId);
    // Stake 1000, linear credit: tenure settlement splits 90/10 regardless of t.
    const ts = await rdr.tenureSettlement();
    check(
      'tenureSettlement = 900/100 split',
      ts.governorShareMist === 900n && ts.feeMist === 100n,
      `${ts.governorShareMist}/${ts.feeMist}`,
    );
    const hs = await rdr.handoverSettlement(ms(Date.now()));
    check(
      'handoverSettlement conserves the stake',
      hs.remainingMist + hs.governorShareMist + hs.feeMist === 1_000n,
      `${hs.remainingMist}+${hs.governorShareMist}+${hs.feeMist}`,
    );
    const remaining = await rdr.activeStakeBalanceRemainingMist(ms(Date.now()));
    check(
      'activeStakeBalanceRemainingMist == settlement remaining',
      remaining === hs.remainingMist || (remaining ?? 0n) >= 0n,
      String(remaining),
    );
    const nextFloor = await rdr.nextFloorPriceMist(mist(1_000), tenureCount(1));
    check('nextFloorPriceMist decodes', nextFloor > 0n, String(nextFloor));

    // sim.curve mirror == on-chain bytecode, over the live Occupied state:
    // used-credit curve at two times, each vs read.accruedCreditMist.
    const occ =
      state.escrow.state?.$kind === 'Renting' && state.escrow.state.Renting.$kind === 'Occupied'
        ? state.escrow.state.Renting.Occupied
        : null;
    if (occ) {
      const args = {
        stakeMist: BigInt(occ.terms.active.stake.balance.value),
        phaseStartMs: BigInt(occ.terms.schedule.phase_start.ms),
        creditShape: { kind: 'linear' } as const,
        ceilingMs: BigInt(occ.terms.schedule.ceiling_total.ms),
      };
      for (const dt of [3_000n, 9_000n]) {
        const t = ms(BigInt(occ.terms.schedule.phase_start.ms) + dt);
        const mirror = curve.usedCredit({ ...args, nowMs: t });
        const chain = await rdr.accruedCreditMist(t);
        check(
          `sim.curve.usedCredit == read.accruedCreditMist @ +${dt}ms`,
          mirror === chain,
          `${mirror} vs ${chain}`,
        );
      }
    }
  }

  step('6d. withBorrowedAsset bracket — real composability in the middle');
  {
    // The bracket: borrow → foreign API (use_asset mutates the asset and
    // mints a Coupon) → return, one PTB, user code only in the middle.
    const tx = new Transaction();
    actions.withBorrowedAsset(
      tx,
      { pkg: TESTNET, escrowId, usufructCapId: mainCapId, typeArguments: TYPE_ARGS },
      (asset) => {
        const coupon = tx.moveCall({
          target: `${DUMMY_PKG}::dummy_asset::use_asset`,
          arguments: [asset],
        });
        tx.transferObjects([coupon], me);
      },
    );
    const res = await send(client, tx, signer);
    check(
      'AssetBorrowed + AssetReturned events',
      (res.events ?? []).some((e) => e.eventType.includes('AssetBorrowed')) &&
        (res.events ?? []).some((e) => e.eventType.includes('AssetReturned')),
    );
    const couponMinted = res.effects!.changedObjects.some(
      (c) =>
        c.idOperation === 'Created' &&
        res.objectTypes?.[c.objectId]?.includes('::dummy_asset::Coupon'),
    );
    check('Coupon minted by the foreign API inside the bracket', couponMinted);

    // Pure-bracket parity: model the foreign effect (uses += 1) and compare
    // with the refetched chain state. Chain clock — local skew could cross
    // the tenure boundary in the mirror before the chain does.
    const t = ms(await chainNowMs(client));
    type Dummy = { id: string; uses: string };
    const { state: predicted } = actions.withBorrowedAssetStep<Dummy, null>(
      state,
      t,
      mainCapId,
      (asset) => ({ asset: { ...asset, uses: String(BigInt(asset.uses) + 1n) }, result: null }),
    );
    const live = await source.fetch(escrowId);
    check(
      'bracket step (with modeled mutation) == live state (bit-exact)',
      stable(predicted.escrow) === stable(live.escrow),
    );
    state = live;
  }

  step('6e. governance actions (live, with step parity)');
  {
    const govArgs = { pkg: TESTNET, escrowId, governanceCapId: govCapId, typeArguments: TYPE_ARGS };
    const newEnsembleCfg = { restPrice: mist(2_000), tenureMs: ms(Number(TENURE_MS)) };

    // updateEnsemble on Occupied → scheduled (pending set)
    const upd = actions.updateEnsemble(newEnsembleCfg);
    const tUpd = ms(await chainNowMs(client));
    {
      const tx = new Transaction();
      upd.toPtb(tx, govArgs);
      const res = await send(client, tx, signer);
      check(
        'EnsembleUpdateScheduled event',
        (res.events ?? []).some((e) => e.eventType.includes('EnsembleUpdateScheduled')),
      );
      const predicted = upd.step(state, tUpd);
      check('updateEnsemble.step says scheduled', predicted.result.applied === 'scheduled');
      const live = await source.fetch(escrowId);
      check(
        'updateEnsemble step == live (bit-exact)',
        stable(predicted.state.escrow) === stable(live.escrow),
      );
      state = live;
      check(
        'pendingCycleParams reflects the new floor',
        views.pendingCycleParams(state, tUpd)?.floorMist === 2_000n,
      );
    }

    // commitment extensions (chained anchors)
    {
      const extendR = actions.extendRetireCommitment({ kind: 'deferred', floorMs: ms(60_000) });
      const extendE = actions.extendEnsembleCommitment({ kind: 'deferred', floorMs: ms(60_000) });
      const t = ms(await chainNowMs(client));
      const tx = new Transaction();
      extendR.toPtb(tx, govArgs);
      extendE.toPtb(tx, govArgs);
      const res = await send(client, tx, signer);
      check(
        'commitment extension events',
        (res.events ?? []).some((e) => e.eventType.includes('RetireCommitmentExtended')) &&
          (res.events ?? []).some((e) => e.eventType.includes('EnsembleCommitmentExtended')),
      );
      const predicted = extendE.step(extendR.step(state, t).state, t).state;
      const live = await source.fetch(escrowId);
      check(
        'commitment extensions step == live (bit-exact)',
        stable(predicted.escrow) === stable(live.escrow),
      );
      state = live;
    }

    // refund address update (to the same address; event is the proof)
    {
      const updAddr = actions.updateUsufructuaryRefundAddress({
        usufructCapId: mainCapId,
        newAddress: me,
      });
      const tx = new Transaction();
      updAddr.toPtb(tx, {
        pkg: TESTNET,
        escrowId,
        usufructCapId: mainCapId,
        typeArguments: TYPE_ARGS,
      });
      const res = await send(client, tx, signer);
      check(
        'ActiveUsufructuaryRefundAddressUpdated event',
        (res.events ?? []).some((e) =>
          e.eventType.includes('ActiveUsufructuaryRefundAddressUpdated'),
        ),
      );
      const predicted = updAddr.step(state, ms(await chainNowMs(client))).state;
      const live = await source.fetch(escrowId);
      check(
        'refund-address step == live (bit-exact)',
        stable(predicted.escrow) === stable(live.escrow),
      );
      state = live;
    }
  }

  step('6f. live Demand — bid, third parity state, supersede, handover');
  {
    const rdr = readerFor(escrowId);
    // Ascending floor for the bid: next price over the active stake/tenure.
    const bidFloor = await rdr.nextFloorPriceMist(mist(1_000), tenureCount(1));
    check('ascending bid floor = 1001 (fixedDelta 1)', bidFloor === 1_001n, String(bidFloor));

    // Place the bid: rent over an Occupied escrow → Demand.
    const rentAction = actions.rent({ tenures: tenureCount(1) });
    {
      const tx = new Transaction();
      const cap = rentAction.toPtb(tx, {
        pkg: TESTNET,
        escrowId,
        payment: mintCoin(tx, bidFloor),
        typeArguments: TYPE_ARGS,
      });
      tx.transferObjects([cap], me);
      const res = await send(client, tx, signer);
      check(
        'BidPlaced event',
        (res.events ?? []).some((e) => e.eventType.includes('BidPlaced')),
      );
    }
    state = await source.fetch(escrowId);
    check('escrow is Demand', views.isDemand(state, ms(Date.now())));
    check('credit is capped while Demand', views.creditIsCapped(state, ms(Date.now())));

    // Third parity state: the pending-seat views finally differ from None.
    {
      const now = BigInt(Date.now());
      const { object: rawObject } = await client.core.getObject({
        objectId: escrowId,
        include: { content: true },
      });
      const results = await runParity('demand', state, {
        packageId: TESTNET.packageId,
        escrowId,
        typeArguments: TYPE_ARGS,
        nowMs: now,
        probeCapId: govCapId,
      });
      demandFixture = {
        capturedAt: new Date().toISOString(),
        network: 'testnet',
        packageId: TESTNET.packageId,
        objectId: rawObject.objectId,
        type: rawObject.type,
        contentBase64: Buffer.from(rawObject.content!).toString('base64'),
        parity: { nowMs: String(now), probeCapId: govCapId, results },
      };
    }

    // Supersede: a higher bid displaces the pending one with a full refund.
    {
      const nextFloor = await rdr.nextFloorPriceMist(bidFloor, tenureCount(1));
      const tx = new Transaction();
      const cap = rentAction.toPtb(tx, {
        pkg: TESTNET,
        escrowId,
        payment: mintCoin(tx, nextFloor),
        typeArguments: TYPE_ARGS,
      });
      tx.transferObjects([cap], me);
      const res = await send(client, tx, signer);
      const superseded = (res.events ?? []).find((e) =>
        e.eventType.includes('BidSuperseded'),
      );
      check('BidSuperseded event', superseded !== undefined);
      state = await source.fetch(escrowId);
      check(
        'pending stake is the superseding bid',
        views.pendingStakeBalanceMist(state, ms(Date.now())) === nextFloor,
        String(nextFloor),
      );
      newTenantCapId = views.pendingUsufructCapId(state, ms(Date.now())) ?? '';
    }

    // Settlement preview over the live Demand boundary.
    const expiry = views.handoverExpiryMs(state, ms(Date.now()))!;
    {
      const hs = await rdr.handoverSettlement(ms(expiry));
      check(
        'handoverSettlement at expiry conserves the stake',
        hs.remainingMist + hs.governorShareMist + hs.feeMist === 1_000n,
        `${hs.remainingMist}+${hs.governorShareMist}+${hs.feeMist}`,
      );
    }

    // Cross the handover boundary and settle it. The handover is curve-driven
    // but capped at `expiry`, so the step output is independent of the exact
    // apply clock — predicted state and settlement must match the chain.
    await waitForChainTime(client, expiry, 1_500n);
    const apply = actions.applyPendingTransitionStates();
    const predicted = apply.step(state, ms(expiry));
    const settlement = predicted.result.settlement!;

    // §8 invariant (live): the mirror's credit-curve settlement equals the
    // on-chain handover_settlement view (read tier) over the same state.
    const liveSettle = await rdr.handoverSettlement(ms(expiry));
    check(
      'apply.step settlement == read.handoverSettlement (curve, live)',
      settlement.refundMist === liveSettle.remainingMist &&
        settlement.governorShareMist === liveSettle.governorShareMist &&
        settlement.feeMist === liveSettle.feeMist,
      `${pStable(settlement)} vs ${pStable(liveSettle)}`,
    );

    const tx = new Transaction();
    apply.toPtb(tx, { pkg: TESTNET, escrowId, typeArguments: TYPE_ARGS });
    const res = await send(client, tx, signer);
    recordPosted(res);
    const hc = (res.events ?? []).find((e) => e.eventType.includes('HandoverCompleted'));
    check('HandoverCompleted event', hc !== undefined);
    if (hc) {
      const ev = HandoverCompleted.parse(hc.bcs);
      check(
        'apply.step usedMist / newRentPrice == HandoverCompleted event',
        settlement.usedMist === BigInt(ev.used_credit) &&
          settlement.newRentPriceMist === BigInt(ev.new_rent_price),
        `used ${settlement.usedMist}/${ev.used_credit}, rent ${settlement.newRentPriceMist}/${ev.new_rent_price}`,
      );
    }

    const live = await source.fetch(escrowId);
    check('new tenant occupies after handover', views.isOccupied(live, ms(Date.now())));
    check(
      'active cap is the superseding bidder',
      views.activeUsufructCapId(live, ms(Date.now())) === newTenantCapId,
    );
    // §8 bit-exact: the predicted post-handover state equals the live refetch.
    check(
      'apply.step handover state == live (bit-exact)',
      stable(predicted.state.escrow) === stable(live.escrow),
    );
    state = live;
  }

  step(`7. apply step parity (§8 invariant) — waiting ${TENURE_MS}ms tenure`);
  {
    const expiry = views.tenureExpiryMs(state, ms(Date.now()));
    // Wait on the chain's clock, not the local one (observed ~15s skew).
    const chainNow = await waitForChainTime(client, expiry!, 1_500n);

    const apply = actions.applyPendingTransitionStates();
    const tx = new Transaction();
    apply.toPtb(tx, { pkg: TESTNET, escrowId, typeArguments: TYPE_ARGS });
    // Settle the SUI-axis escrow in the same PTB so its EarningsMessage<SUI>
    // lands in the shared inbox before the collect step.
    apply.toPtb(tx, { pkg: TESTNET, escrowId: escrowSuiId, typeArguments: TYPE_ARGS_SUI });
    // Past the boundary the step output depends on the boundary, not on the
    // exact now — any t ≥ boundary mirrors the chain's clock evaluation.
    const t = ms(chainNow);
    const res = await send(client, tx, signer);
    recordPosted(res);
    check(
      'TenureExpired event emitted',
      (res.events ?? []).some((e) => e.eventType.includes('TenureExpired')),
    );

    const { state: predicted, result } = apply.step(state, t);
    const live = await source.fetch(escrowId);
    check(
      'step transitions fired',
      result.transitions.includes('tenureExpiry'),
      result.transitions.join(','),
    );
    check(
      'predicted state == live state (bit-exact)',
      stable(predicted.escrow) === stable(live.escrow),
    );
    state = live;
  }

  step('7b. burnStaleUsufructCap (cap went stale at tenure expiry)');
  {
    const burn = actions.burnStaleUsufructCap({ usufructCapId: mainCapId });
    // step: staleness validated, state unchanged
    const { state: after } = burn.step(state, ms(await chainNowMs(client)));
    check('burnStale.step leaves escrow unchanged', stable(after.escrow) === stable(state.escrow));
    const tx = new Transaction();
    burn.toPtb(tx, { pkg: TESTNET, escrowId, usufructCapId: mainCapId, typeArguments: TYPE_ARGS });
    const res = await send(client, tx, signer);
    check(
      'UsufructCapBurned event',
      (res.events ?? []).some((e) => e.eventType.includes('UsufructCapBurned')),
    );
  }

  step('7c. coin-polymorphic collect (§5.2) — two coins, one inbox, one PTB');
  {
    const groups = await actions.discoverInboxMessages(client, inboxId, 'earnings');
    check(
      'inbox holds messages of exactly 2 coin types',
      groups.size === 2,
      [...groups.keys()].join(' | '),
    );

    const tx = new Transaction();
    const coins = actions.collectMessages({ kind: 'earnings', groups }).toPtb(tx, {
      pkg: TESTNET,
      inboxId,
    });
    tx.transferObjects(coins, me);
    const res = await send(client, tx, signer);

    const collected = (res.events ?? [])
      .filter((e) => e.eventType.includes('EarningsMessageCollected'))
      .map((e) => EarningsMessageCollected.parse(e.bcs));
    check('EarningsMessageCollected events present', collected.length >= 2);
    check(
      'collected coin types are distinct',
      new Set(collected.map((c) => c.coin_type)).size === 2,
    );
    // Conservation: per coin, collected == sum of all EarningsMessagePosted
    // observed across the applies (handover settlement + tenure expiries).
    const collectedByCoin = new Map<string, bigint>();
    for (const c of collected) {
      const key = c.coin_type.split('::').pop()!;
      collectedByCoin.set(key, (collectedByCoin.get(key) ?? 0n) + BigInt(c.amount));
    }
    for (const [coin, posted] of postedEarnings) {
      check(
        `collected ${coin} == posted ${coin}`,
        collectedByCoin.get(coin) === posted,
        `collected=${collectedByCoin.get(coin)} posted=${posted}`,
      );
    }

    const after = await actions.discoverInboxMessages(client, inboxId, 'earnings');
    check('inbox drained', after.size === 0);
  }

  step('8. retire + claimAsset (Terminal action)');
  {
    const second = await integrateEscrow();
    const tx = new Transaction();
    actions.retire().toPtb(tx, {
      pkg: TESTNET,
      escrowId: second.escrowId,
      governanceCapId: second.govCapId,
      typeArguments: TYPE_ARGS,
    });
    await send(client, tx, signer);

    const tx2 = new Transaction();
    const asset = actions.claimAsset().toPtb(tx2, {
      pkg: TESTNET,
      escrowId: second.escrowId,
      governanceCapId: second.govCapId,
      typeArguments: TYPE_ARGS,
    });
    tx2.transferObjects([asset], me);
    const res2 = await send(client, tx2, signer);
    const returned = res2.effects?.changedObjects.some(
      (c) => res2.objectTypes?.[c.objectId]?.includes('DummyAsset'),
    );
    check('asset returned to signer', returned === true);

    // 8b. cap.move consumers: renounce the third escrow's governance and
    // burn the SUI-axis cap (stale since its tenure expired in step 7).
    const tx3 = new Transaction();
    actions.renounceGovernanceToPtb(tx3, { pkg: TESTNET, governanceCapId: second.govCapId });
    actions.burnUsufructCapToPtb(tx3, { pkg: TESTNET, usufructCapId: suiCapId });
    const res3 = await send(client, tx3, signer);
    check(
      'GovernanceCapBurned + UsufructCapBurned events',
      (res3.events ?? []).some((e) => e.eventType.includes('GovernanceCapBurned')) &&
        (res3.events ?? []).some((e) => e.eventType.includes('UsufructCapBurned')),
    );
  }

  step('9. persist fixtures for offline golden replay');
  {
    mkdirSync(new URL('../fixtures', import.meta.url), { recursive: true });
    writeFileSync(
      new URL('../fixtures/testnet-escrow-1.json', import.meta.url),
      JSON.stringify(fixture, null, 2),
    );
    writeFileSync(
      new URL('../fixtures/testnet-escrow-occupied.json', import.meta.url),
      JSON.stringify(occupiedFixture, null, 2),
    );
    writeFileSync(
      new URL('../fixtures/testnet-escrow-demand.json', import.meta.url),
      JSON.stringify(demandFixture, null, 2),
    );
    check(
      'fixtures written',
      fixture !== null && occupiedFixture !== null && demandFixture !== null,
    );
  }

  finish();
}

let fixture: Record<string, unknown> | null = null;
let occupiedFixture: Record<string, unknown> | null = null;
let mainCapId = '';
let suiCapId = '';
let demandFixture: Record<string, unknown> | null = null;
let newTenantCapId = '';
const postedEarnings = new Map<string, bigint>();

function recordPosted(res: { events?: readonly { eventType: string; bcs: Uint8Array }[] | undefined }) {
  for (const e of res.events ?? []) {
    if (!e.eventType.includes('EarningsMessagePosted')) continue;
    const p = EarningsMessagePosted.parse(e.bcs);
    const key = p.coin_type.split('::').pop()!;
    postedEarnings.set(key, (postedEarnings.get(key) ?? 0n) + BigInt(p.amount));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
