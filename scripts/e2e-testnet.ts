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
import * as escrowCalls from '../src/codegen/usufruct/escrow.js';
import { TESTNET } from '../src/config/network.js';
import { id, ms, tenureCount } from '../src/primitives/brand.js';
import { chainSource } from '../src/primitives/source.js';
import * as inspect from '../src/views/inspect.js';
import * as views from '../src/views/index.js';
import {
  check,
  createdId,
  finish,
  loadSigner,
  makeClient,
  send,
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
const TYPE_ARGS: [string, string] = [ASSET_T, COIN_T];
const TENURE_MS = 30_000n;

const client = makeClient();
const signer = loadSigner();
const me = signer.toSuiAddress();

// DummyAsset is NOT uid-only ({ id: UID, uses: u64 }) — the integrator-supplied
// schema path (SPEC §10). Decoding with the wrong schema silently misaligns
// every field after the asset; observed live before this schema was added.
const dummyAssetSchema = bcs.struct('DummyAsset', { id: bcs.Address, uses: bcs.u64() });
const source = chainSource(client, { assetSchema: dummyAssetSchema });

/** Key-order-insensitive deep equality (BCS parse emits `$kind` last). */
function stable(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    v !== null && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as object).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
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
  const { escrowId, govCapId, action: integrateAction } = await integrateEscrow();
  check('escrow created', escrowId.length === 66, escrowId);
  check('governance cap created', govCapId.length === 66);

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

  step('4. Pattern B live parity (prototype golden gate)');
  {
    const now = BigInt(Date.now());
    // Raw bytes of the same version the parity answers describe (fixture).
    const { object: rawObject } = await client.core.getObject({
      objectId: escrowId,
      include: { content: true },
    });
    const tx = new Transaction();
    tx.setSender(me);
    const opts = { package: TESTNET.packageId, typeArguments: TYPE_ARGS } as const;
    tx.add(escrowCalls.isIdle({ ...opts, arguments: [escrowId] }));
    tx.add(escrowCalls.isRented({ ...opts, arguments: [escrowId] }));
    tx.add(escrowCalls.isRetired({ ...opts, arguments: [escrowId] }));
    tx.add(escrowCalls.assetId({ ...opts, arguments: [escrowId] }));
    tx.add(escrowCalls.governanceCapId({ ...opts, arguments: [escrowId] }));
    tx.add(escrowCalls.activeUsufructuaryAddr({ ...opts, arguments: [escrowId] }));
    tx.add(escrowCalls.phaseStartMs({ ...opts, arguments: [escrowId] }));
    tx.add(escrowCalls.tenureExpiryMs({ ...opts, arguments: [escrowId] }));
    tx.add(escrowCalls.transitionIsReady({ ...opts, arguments: [escrowId, now] }));
    tx.add(escrowCalls.nextTransitionMs({ ...opts, arguments: [escrowId, now] }));
    const sim = await client.core.simulateTransaction({
      transaction: tx,
      checksEnabled: false,
      include: { commandResults: true },
    });
    if (sim.$kind !== 'Transaction') throw new Error('parity sim failed');
    const ret = (i: number) => sim.commandResults![i]!.returnValues[0]!.bcs;
    const optU64 = bcs.option(bcs.u64());
    const optAddr = bcs.option(bcs.Address);
    const t = ms(now);

    const onchain = {
      isIdle: bcs.bool().parse(ret(0)),
      isRented: bcs.bool().parse(ret(1)),
      isRetired: bcs.bool().parse(ret(2)),
      assetId: bcs.Address.parse(ret(3)),
      governanceCapId: bcs.Address.parse(ret(4)),
      activeAddr: optAddr.parse(ret(5)),
      phaseStartMs: optU64.parse(ret(6)),
      tenureExpiryMs: optU64.parse(ret(7)),
      transitionIsReady: bcs.bool().parse(ret(8)),
      nextTransitionMs: optU64.parse(ret(9)),
    };
    check('isIdle parity', views.isIdle(state, t) === onchain.isIdle);
    check('isRented parity', views.isRented(state, t) === onchain.isRented);
    check('isRetired parity', views.isRetired(state, t) === onchain.isRetired);
    check('assetId parity', views.assetId(state, t) === onchain.assetId);
    check('governanceCapId parity', views.governanceCapId(state, t) === onchain.governanceCapId);
    check(
      'activeUsufructuaryAddr parity',
      views.activeUsufructuaryAddr(state, t) === onchain.activeAddr,
    );
    check(
      'phaseStartMs parity',
      String(views.phaseStartMs(state, t)) === String(onchain.phaseStartMs),
    );
    check(
      'tenureExpiryMs parity',
      String(views.tenureExpiryMs(state, t)) === String(onchain.tenureExpiryMs),
    );
    check(
      'transitionIsReady parity',
      views.transitionIsReady(state, t) === onchain.transitionIsReady,
    );
    check(
      'nextTransitionMs parity',
      String(views.nextTransitionMs(state, t)) === String(onchain.nextTransitionMs),
    );

    // Persisted later (step 9) for offline replay.
    fixture = {
      capturedAt: new Date().toISOString(),
      network: 'testnet',
      packageId: TESTNET.packageId,
      objectId: rawObject.objectId,
      type: rawObject.type,
      contentBase64: Buffer.from(rawObject.content!).toString('base64'),
      parity: { nowMs: String(now), onchain: JSON.parse(JSON.stringify(onchain)) },
    };
  }

  step('5. Pattern A devInspect reads');
  {
    // accrued_credit_mist aborts on a non-rented escrow (observed live) —
    // it is read after rent, in step 6.
    const target = { client, packageId: TESTNET.packageId, escrowId, typeArguments: TYPE_ARGS };
    const floor = await inspect.floorPriceMist(target, ms(Date.now()));
    check('floorPriceMist == rest price', floor === 1_000n, String(floor));
  }

  step('6. rent (Transition action)');
  {
    const action = actions.rent({ tenures: tenureCount(1) });
    const tx = new Transaction();
    const cap = action.toPtb(tx, {
      pkg: TESTNET,
      escrowId,
      payment: mintCoin(tx, 1_000n),
      typeArguments: TYPE_ARGS,
    });
    tx.transferObjects([cap], me);
    await send(client, tx, signer);
    state = await source.fetch(escrowId);
    check('escrow is Occupied after rent', views.isOccupied(state, ms(Date.now())));

    const target = { client, packageId: TESTNET.packageId, escrowId, typeArguments: TYPE_ARGS };
    const credit = await inspect.accruedCreditMist(target, ms(Date.now()));
    check('accruedCreditMist decodes while rented', credit >= 0n, String(credit));
  }

  step(`7. apply step parity (§8 invariant) — waiting ${TENURE_MS}ms tenure`);
  {
    const expiry = views.tenureExpiryMs(state, ms(Date.now()));
    // Wait on the chain's clock, not the local one (observed ~15s skew).
    const chainNow = await waitForChainTime(client, expiry!, 1_500n);

    const apply = actions.applyPendingTransitionStates();
    const tx = new Transaction();
    apply.toPtb(tx, { pkg: TESTNET, escrowId, typeArguments: TYPE_ARGS });
    // Past the boundary the step output depends on the boundary, not on the
    // exact now — any t ≥ boundary mirrors the chain's clock evaluation.
    const t = ms(chainNow);
    const res = await send(client, tx, signer);
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
  }

  step('9. persist fixture for offline golden replay');
  {
    mkdirSync(new URL('../fixtures', import.meta.url), { recursive: true });
    writeFileSync(
      new URL('../fixtures/testnet-escrow-1.json', import.meta.url),
      JSON.stringify(fixture, null, 2),
    );
    check('fixture written', fixture !== null, 'fixtures/testnet-escrow-1.json');
  }

  finish();
}

let fixture: Record<string, unknown> | null = null;

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
