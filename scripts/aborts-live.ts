/**
 * Live abort mapping (drift-zero errors) — provoke every deterministically
 * reachable on-chain abort and assert the SDK surfaces it as a clear typed error
 * naming the Move source constant. The chain is the arbiter. Run: `npm run aborts`.
 *
 * Coverage (≈23 aborts + a compound-success check, 3 cheap escrows — a rejected tx
 * is state-preserving, so one escrow absorbs many aborts in sequence):
 *
 *   Tier 1 — policy aborts via governanceCap.updateMarket (escrow A):
 *     EPriceZero, EDurationZero, EDescentCeilingZero, EHandoverFloorZero,
 *     EHandoverFloorExceedsTenure, EDeltaZero, EBpsRange, EDegenerateLinear
 *   Tier 1b — commitment floors, reachable only at integrate-time (updateMarket
 *     carries only the ensemble, not the commitments):
 *     ERetireCommitmentFloorZero, EEnsembleCommitmentFloorZero
 *   Tier 2 — type-guarded range aborts (escrow A, reached only via `as` casts —
 *     the typed API makes these a *compile* error, see market.ts):
 *     EAlphaNumRange, EAlphaDenRange, EAlphaAbsRange
 *   Tier 3 — rent-path aborts (escrow A): EInsufficientPayment, ETenuresZero
 *   Tier 4 — state machine (escrow B, in order): ENotRetired → retire(ok) →
 *     EAlreadyRetired → ERetiredNoBid
 *   Tier 5 — commitments + multi-cycle (escrow C): EMultiCycleNotAllowed,
 *     ERetireCommitmentFloorNotElapsed, EEnsembleCommitmentFloorNotElapsed
 *   Tier 6 — happy path the v1.4.3 fix unblocks: a VALID compound escalation
 *     commits (proves `ensemble::basis_points` end-to-end)
 *
 * NOT exercised live (the offline test `test/highlevel-aborts.test.ts` proves the
 * mapping for all 39 runtime constants from fabricated abort strings):
 *   • cross-escrow object mixing — EWrongEscrowUsufructCap, EWrongEscrowGovernanceCap,
 *     EReceiptEscrowMismatch, EReturnedDifferentAsset (the handles bind each cap to
 *     its escrow; only a raw PTB could mix them)
 *   • multi-actor seat dynamics — EPendingUsufructCap, EStaleUsufructCap,
 *     EUsufructCapStale, EUsufructCapNotStale, ERetireFlagBlocksBid,
 *     ERetireAlreadyScheduled (need a second renter / displacement + timing)
 *   • commitment-not-extended — ERetireCommitmentNotExtended, EEnsembleCommitmentNotExtended
 *   • internal / overflow / view-only — EAlreadyRetiring, EMulDivOverflow,
 *     ENthRootBadDegree, EPriceAddOverflow, escrow::EAssetBorrowed, ENotRented
 *
 * Note on gas: a deterministic abort costs ZERO gas and leaves NO on-chain tx —
 * the SDK doesn't set a gas budget, so @mysten/sui estimates it via a pre-flight
 * dry-run; the MoveAbort fires there and the tx is never signed/submitted. Only the
 * three `integrate`s (and the one real `retire`) actually commit — reclaim those
 * escrows with `npm run clean`.
 */
import { Transaction } from '@mysten/sui/transactions';
import {
  coinTag,
  usufruct,
  InvalidMarket,
  InvalidEscalation,
  InvalidShape,
  InsufficientPayment,
  NotAvailable,
  CommittedRetire,
  CommittedEnsemble,
  MoveAbortError,
  isTransientRead,
  type Market,
  type PowerLawNum,
  type PowerLawDen,
  type ExpAlpha,
} from '@usufruct-protocol/sdk';
import { check, createdId, finish, loadSigner, makeClient, rateLimited, send, sleep, step } from './lib.js';

const DUMMY_PKG = '0xa72e830fcb3e688ab3c20ff3cbd0a149cd1b58715709905585e75eb18317a52a';
const DUMMY_COIN_PKG = '0x97fb7c77162e3edf6a44815ec9eb29b69f9a43747dfb1c1019a7fc5501e2ad96';
const DUMMY = coinTag({ type: `${DUMMY_COIN_PKG}::dummy_coin::DUMMY_COIN`, decimals: 9, symbol: 'DUMMY' });

const client = rateLimited(makeClient());
const ALICE = loadSigner();
const me = ALICE.toSuiAddress();

/** Standard immediate-commitment market (escrows A and B). */
const market: Market = {
  restPrice: DUMMY(0.01),
  tenure: '5m',
  multiTenure: true,
  creditShape: 'linear',
  auctionShape: 'linear',
  descent: 'off',
  handover: '15s',
  escalation: { fixed: DUMMY(0.001) },
  retireCommitment: 'immediate',
  ensembleCommitment: 'immediate',
};

/** Single-tenure market with deferred commitments (escrow C). */
const committedMarket: Market = {
  ...market,
  multiTenure: false,
  retireCommitment: { deferredFor: '1h' },
  ensembleCommitment: { deferredFor: '1h' },
};

async function mintAsset(): Promise<string> {
  const tx = new Transaction();
  tx.transferObjects([tx.moveCall({ target: `${DUMMY_PKG}::dummy_asset::mint` })], me);
  return createdId(await send(client, tx, ALICE), '::dummy_asset::DummyAsset');
}

/**
 * Run a write that must abort; return the caught error (or throw if it didn't).
 * A write like `updateMarket` first does a `devInspect` pre-read which, under
 * public-fullnode 429 pressure, can return a truncated result — a transient,
 * non-abort error. Those are retried (with backoff) so a flaky read never
 * masquerades as a missing abort.
 */
async function expectAbort(label: string, run: () => Promise<unknown>, attempts = 6): Promise<unknown> {
  for (let i = 0; ; i++) {
    try {
      await run();
    } catch (e) {
      if (isTransientRead(e) && i < attempts - 1) {
        console.log(`  …transient read, retry ${i + 1}/${attempts - 1}`);
        await sleep(1_500 * (i + 1));
        continue;
      }
      return e;
    }
    throw new Error(`${label}: expected an abort, but the write succeeded`);
  }
}

type Expect = {
  /** Expected friendly overlay subclass (when one is mapped). */
  readonly cls?: new (...a: never[]) => Error;
  readonly abort: string;
  readonly module: string;
  readonly code: number;
};

/** Assert a caught error is the expected Move abort, by its source nomenclature. */
function assertAbort(label: string, err: unknown, exp: Expect): void {
  const e = err as MoveAbortError;
  if (exp.cls) {
    check(`${label}: instanceof ${exp.cls.name}`, e instanceof exp.cls, e?.constructor?.name ?? typeof e);
  }
  check(`${label}: .abort === ${exp.abort}`, e?.abort === exp.abort, String(e?.abort));
  check(
    `${label}: ${exp.module} #${exp.code}`,
    e?.module === exp.module && e?.code === exp.code,
    `${e?.module} #${e?.code}`,
  );
  console.log(`  → ${(e as Error)?.message}`);
}

async function main(): Promise<void> {
  const u = usufruct({ network: 'testnet', client, signer: ALICE });

  step('setup — integrate three escrows (A: standard, B: state-machine, C: committed)');
  // Sequential, not Promise.all: parallel txs from one signer race on the gas coin.
  const a = await u.integrate({ asset: await mintAsset(), coin: DUMMY, market }).send();
  const b = await u.integrate({ asset: await mintAsset(), coin: DUMMY, market }).send();
  const c = await u.integrate({ asset: await mintAsset(), coin: DUMMY, market: committedMarket }).send();
  const A = a.escrow,
    B = b.escrow,
    C = c.escrow;
  console.log(`  A ${A.id.slice(0, 12)}…  B ${B.id.slice(0, 12)}…  C ${C.id.slice(0, 12)}…`);

  // ── Tiers 1 & 2 — every policy abort via updateMarket, on the one escrow A.
  // Each is state-preserving: A's market is never actually changed.
  const PATCHES: ReadonlyArray<{ label: string; patch: Partial<Market>; expect: Expect }> = [
    // Tier 1 — reachable with valid, typed values.
    { label: 'restPrice = 0', patch: { restPrice: A.coin(0) }, expect: { cls: InvalidMarket, abort: 'EPriceZero', module: 'rest_price_policy', code: 0 } },
    { label: 'tenure = 0', patch: { tenure: 0 }, expect: { cls: InvalidMarket, abort: 'EDurationZero', module: 'tenure_duration_policy', code: 0 } },
    { label: 'descent = 0', patch: { descent: 0 }, expect: { cls: InvalidMarket, abort: 'EDescentCeilingZero', module: 'auction_window_policy', code: 0 } },
    { label: 'handover = 0', patch: { handover: 0 }, expect: { cls: InvalidMarket, abort: 'EHandoverFloorZero', module: 'handover_policy', code: 0 } },
    { label: 'handover > tenure', patch: { handover: '10m', tenure: '2m' }, expect: { cls: InvalidMarket, abort: 'EHandoverFloorExceedsTenure', module: 'policy_ensemble', code: 0 } },
    // NOTE: the commitment floors are NOT settable via updateMarket (it sends only
    // the ensemble, not the commitments — governanceCap.ts) — so ERetireCommitmentFloorZero
    // / EEnsembleCommitmentFloorZero are provoked at integrate-time below (Tier 1b).
    { label: 'escalation fixed 0', patch: { escalation: { fixed: A.coin(0) } }, expect: { cls: InvalidEscalation, abort: 'EDeltaZero', module: 'price_escalation_policy', code: 0 } },
    // Compound escalation: v1.4.3's `ensemble::basis_points` constructor makes the bps
    // arg a real `BasisPoints`, so the policy is now reachable on-chain (was unbuildable
    // on v1.4.2). bps 0 < 1 → EBpsRange.
    { label: 'escalation compound bps 0', patch: { escalation: { compound: { bps: 0, delta: DUMMY(0.001) } } }, expect: { cls: InvalidEscalation, abort: 'EBpsRange', module: 'price_escalation_policy', code: 1 } },
    { label: 'creditShape powerLaw 2/2 (= linear)', patch: { creditShape: { powerLaw: { num: 2, den: 2 } } }, expect: { cls: InvalidShape, abort: 'EDegenerateLinear', module: 'curve_shape_policy', code: 2 } },
    // Tier 2 — the typed API forbids these; cast past it to prove the live mapping.
    { label: 'powerLaw num out of range (cast)', patch: { creditShape: { powerLaw: { num: 0 as PowerLawNum, den: 1 } } }, expect: { cls: InvalidShape, abort: 'EAlphaNumRange', module: 'curve_shape_policy', code: 0 } },
    { label: 'powerLaw den out of range (cast)', patch: { creditShape: { powerLaw: { num: 1, den: 0 as PowerLawDen } } }, expect: { cls: InvalidShape, abort: 'EAlphaDenRange', module: 'curve_shape_policy', code: 1 } },
    { label: 'exponential alpha out of range (cast)', patch: { creditShape: { exponential: { alpha: 9 as ExpAlpha } } }, expect: { cls: InvalidShape, abort: 'EAlphaAbsRange', module: 'curve_shape_policy', code: 3 } },
  ];

  step(`Tiers 1 & 2 — ${PATCHES.length} policy aborts via updateMarket (escrow A)`);
  for (const { label, patch, expect } of PATCHES) {
    const e = await expectAbort(label, () => A.governanceCap.updateMarket(A.id, patch).send());
    assertAbort(label, e, expect);
  }

  // ── Tier 1b — commitment-floor-zero aborts: reachable only at integrate-time
  // (updateMarket doesn't carry commitments). A rejected integrate doesn't consume
  // the asset, so one minted asset serves both attempts.
  step('Tier 1b — commitment-floor-zero aborts (integrate-time)');
  const badAsset = await mintAsset();
  const e_rc = await expectAbort('integrate retireCommitment deferredFor 0', () =>
    u.integrate({ asset: badAsset, coin: DUMMY, market: { ...market, retireCommitment: { deferredFor: 0 } } }).send(),
  );
  assertAbort('integrate retireCommitment deferredFor 0', e_rc, { cls: InvalidMarket, abort: 'ERetireCommitmentFloorZero', module: 'retire_commitment_policy', code: 0 });

  const e_ec = await expectAbort('integrate ensembleCommitment deferredFor 0', () =>
    u.integrate({ asset: badAsset, coin: DUMMY, market: { ...market, ensembleCommitment: { deferredFor: 0 } } }).send(),
  );
  assertAbort('integrate ensembleCommitment deferredFor 0', e_ec, { cls: InvalidMarket, abort: 'EEnsembleCommitmentFloorZero', module: 'ensemble_commitment_policy', code: 0 });

  // ── Tier 3 — rent-path aborts (escrow A, state-preserving).
  step('Tier 3 — rent-path aborts (escrow A)');
  const e_pay = await expectAbort('pay below floor', () => A.rent({ tenures: 1, pay: DUMMY(0.001) }).send());
  assertAbort('pay below floor', e_pay, { cls: InsufficientPayment, abort: 'EInsufficientPayment', module: 'asset_state', code: 1 });

  const e_ten = await expectAbort('tenures = 0', () => A.rent({ tenures: 0, pay: DUMMY(0.01) }).send());
  assertAbort('tenures = 0', e_ten, { abort: 'ETenuresZero', module: 'tenures', code: 0 });

  // ── Tier 4 — state machine on escrow B, in order (one success advances state).
  step('Tier 4 — state-machine sequence (escrow B)');
  const e_claim = await expectAbort('claim before retire', () => B.governanceCap.claim(B.id).send());
  assertAbort('claim before retire', e_claim, { cls: MoveAbortError, abort: 'ENotRetired', module: 'asset_state', code: 12 });

  console.log('  retire(B) — should SUCCEED (advances to Retired)');
  await B.governanceCap.retire(B.id).send();
  check('retire succeeded', true);

  const e_retire2 = await expectAbort('retire twice', () => B.governanceCap.retire(B.id).send());
  assertAbort('retire twice', e_retire2, { cls: MoveAbortError, abort: 'EAlreadyRetired', module: 'asset_state', code: 5 });

  const e_rentRetired = await expectAbort('rent after retire', () => B.rent({ tenures: 1 }).send());
  assertAbort('rent after retire', e_rentRetired, { cls: NotAvailable, abort: 'ERetiredNoBid', module: 'asset_state', code: 3 });

  // ── Tier 5 — commitments + multi-cycle (escrow C, all state-preserving).
  step('Tier 5 — commitment windows + multi-cycle (escrow C)');
  const e_multi = await expectAbort('rent 2 tenures (multiTenure off)', () => C.rent({ tenures: 2 }).send());
  assertAbort('rent 2 tenures (multiTenure off)', e_multi, { abort: 'EMultiCycleNotAllowed', module: 'tenure_extend_policy', code: 0 });

  const e_committedRetire = await expectAbort('retire before commitment elapses', () => C.governanceCap.retire(C.id).send());
  assertAbort('retire before commitment elapses', e_committedRetire, { cls: CommittedRetire, abort: 'ERetireCommitmentFloorNotElapsed', module: 'asset_state', code: 4 });

  const e_committedEnsemble = await expectAbort('updateMarket before commitment elapses', () => C.governanceCap.updateMarket(C.id, { restPrice: DUMMY(0.02) }).send());
  assertAbort('updateMarket before commitment elapses', e_committedEnsemble, { cls: CommittedEnsemble, abort: 'EEnsembleCommitmentFloorNotElapsed', module: 'asset_state', code: 18 });

  // ── Tier 6 — the happy path the v1.4.3 fix unblocks: a VALID compound escalation
  // now builds (via ensemble::basis_points) and commits. Mutates A's market, so it
  // runs last. This is the positive complement to the EBpsRange abort above.
  step('Tier 6 — compound escalation succeeds (v1.4.3 basis_points)');
  try {
    const { digest } = await A.governanceCap.updateMarket(A.id, { escalation: { compound: { bps: 100, delta: DUMMY(0.001) } } }).send();
    check('compound escalation updateMarket committed', true, `${digest.slice(0, 12)}…`);
  } catch (err) {
    check('compound escalation updateMarket committed', false, (err as Error).message);
  }
}

main().then(finish);
