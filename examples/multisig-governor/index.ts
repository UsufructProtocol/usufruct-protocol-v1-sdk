/**
 * PROBE C — multisig governor: does the `Executor` seam express N-party signing?
 *
 * A `GovernanceCap` held by a 2-of-3 multisig governs a rental market. A
 * governance write (here `updateMarket`) must be signed by ≥2 constituents whose
 * partial signatures combine into one multisig signature.
 *
 * The hypothesis: this fits the EXISTING `Executor` seam with ZERO core changes —
 * a `multisigExecutor` is ~10 lines composing the SDK's exported `executeSigned`
 * with `@mysten/sui`'s `MultiSigPublicKey`. If that holds, the primitive is right.
 *
 * Finding (see README): it holds, BOTH ways — and the whole TREASURY LOOP runs live:
 *   ① govern, synchronous  — all signers in-process via a `multisigExecutor`; `.send()`.
 *   ② govern, distributed  — `toTransaction()` → build bytes once → each party signs the
 *      bytes apart in time → `combinePartialSignatures` → `executeSigned` → `plan.decode`.
 *   ③ earn                 — a renter pays the floor; the tenancy settles into the inbox.
 *   ④ collect              — the multisig banks the earnings (`earningsInbox.collect()`),
 *                            the defining treasury action, through the very same seam.
 * What travels between distributed signers is two strings (bytes + each signature).
 *
 * Run from the monorepo root:  npx tsx examples/multisig-governor/index.ts
 * (needs a funded testnet signer: SUI_PRIVATE_KEY env, or the `usufruct-sdk-testnet`
 *  CLI alias. The operator funds the multisig's gas and hands it the cap.)
 */
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { MultiSigPublicKey } from '@mysten/sui/multisig';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Transaction } from '@mysten/sui/transactions';
import { toBase64 } from '@mysten/sui/utils';
import {
  coinTag,
  executeSigned,
  signerExecutor,
  usufruct,
  type Executor,
} from '@usufruct-protocol/sdk';
// The funded "operator" is boilerplate a real app would not write (it just lists
// an asset and funds the multisig). We reuse the repo harness loader; in your own
// app, load your signer however you like (e.g. `Ed25519Keypair.fromSecretKey(env)`).
import { loadSigner, waitForChainTime } from '../../scripts/lib.js';

const GRPC_URL = 'https://fullnode.testnet.sui.io:443';
const DUMMY_PKG = '0xa72e830fcb3e688ab3c20ff3cbd0a149cd1b58715709905585e75eb18317a52a';
const DUMMY_COIN_PKG = '0x97fb7c77162e3edf6a44815ec9eb29b69f9a43747dfb1c1019a7fc5501e2ad96';
const DUMMY = coinTag({ type: `${DUMMY_COIN_PKG}::dummy_coin::DUMMY_COIN`, decimals: 9, symbol: 'DUMMY' });

const client = new SuiGrpcClient({ network: 'testnet', baseUrl: GRPC_URL });

// ─────────────────────────────────────────────────────────────────────────────
// THE PROBE: a multisig as a first-class Executor. ~10 lines, zero core changes.
// The wallet only-signs lesson generalizes: the SDK executes + enriches; here the
// "signer" is N keypairs whose partial sigs combine into one multisig signature.
// ─────────────────────────────────────────────────────────────────────────────
function multisigExecutor(
  msPk: MultiSigPublicKey,
  signers: Ed25519Keypair[],
): Executor {
  return {
    address: msPk.toSuiAddress(),
    execute: async (tx) => {
      tx.setSenderIfNotSet(msPk.toSuiAddress());
      const bytes = await tx.build({ client });
      const partials = await Promise.all(
        signers.map((s) => s.signTransaction(bytes).then((r) => r.signature)),
      );
      const combined = msPk.combinePartialSignatures(partials);
      return executeSigned(client, toBase64(bytes), [combined]);
    },
  };
}

async function main() {
  const operator = loadSigner(); // the funded operator (boilerplate)
  console.log('operator', operator.toSuiAddress());

  // 1. A 2-of-3 multisig — three independent keypairs, any two suffice.
  const [a, b, c] = [Ed25519Keypair.generate(), Ed25519Keypair.generate(), Ed25519Keypair.generate()];
  const msPk = MultiSigPublicKey.fromPublicKeys({
    threshold: 2,
    publicKeys: [
      { publicKey: a.getPublicKey(), weight: 1 },
      { publicKey: b.getPublicKey(), weight: 1 },
      { publicKey: c.getPublicKey(), weight: 1 },
    ],
  });
  const msAddr = msPk.toSuiAddress();
  console.log('multisig (2-of-3)', msAddr);

  // 2. operator lists an asset, then HANDS the GovernanceCap to the multisig and
  //    funds its gas — so the multisig (not the operator) governs from here on.
  const op = usufruct({ client, signer: operator });
  const mintTx = new Transaction();
  const sword = mintTx.moveCall({ target: `${DUMMY_PKG}::dummy_asset::mint` });
  mintTx.transferObjects([sword], operator.toSuiAddress());
  const mintRes = await signerExecutor(client, operator).execute(mintTx);
  const swordId = mintRes.effects!.changedObjects!.find(
    (o) => o.idOperation === 'Created' && mintRes.objectTypes?.[o.objectId]?.includes('::dummy_asset::DummyAsset'),
  )!.objectId;

  const { escrow, governanceCap, earningsInbox } = await op
    .integrate({
      asset: swordId,
      coin: DUMMY,
      market: {
        restPrice: DUMMY(0.01),
        tenure: '20s',
        multiTenure: false,
        creditShape: 'linear',
        auctionShape: 'smoothstep',
        descent: '10s',
        handover: '5s',
        escalation: { fixed: DUMMY(0.001) },
        retireCommitment: 'immediate',
        ensembleCommitment: 'immediate',
      },
    })
    .send();
  console.log('escrow', escrow.id, '· floor', String(escrow.floorPrice), '· cap', governanceCap.capId);

  // Hand BOTH the GovernanceCap (to govern) AND the EarningsInbox (to bank income)
  // to the multisig + fund its gas — the multisig is now the treasury. One tx.
  const handoverTx = new Transaction();
  handoverTx.transferObjects(
    [
      handoverTx.object(governanceCap.capId),
      handoverTx.object(earningsInbox.inboxId),
      handoverTx.splitCoins(handoverTx.gas, [100_000_000n])[0]!,
    ],
    msAddr,
  );
  await signerExecutor(client, operator).execute(handoverTx);
  console.log('→ GovernanceCap + EarningsInbox transferred to the multisig; gas funded\n');

  const dao = usufruct({ client });
  console.log('multisig session address', msAddr, '\n');

  // ── FORM 1: synchronous — all signers in-process via a multisigExecutor ──
  // The session's default signer is the multisig; `.send()` is identical to the
  // held-Signer path. Raises the rest price 0.01 → 0.02 DUMMY.
  dao.connect(multisigExecutor(msPk, [a, b]));
  const sync = await dao.governanceCap(governanceCap.capId).updateMarket(escrow.id, {
    restPrice: DUMMY(0.02),
  }).send();
  console.log('① synchronous (multisigExecutor, a+b in-process) — digest', sync.digest);
  console.log('   floor →', String((await dao.escrow(escrow.id)).floorPrice));

  // ── FORM 2: distributed/asynchronous — signers apart in time, no live process ──
  // Build the bytes ONCE; what travels between parties is two strings (bytes +
  // each signature). Party A signs, then (hours/days later, another machine) party
  // B signs, then anyone combines + executes. This is a real DAO/treasury flow.
  // Raises the rest price 0.02 → 0.03 DUMMY.
  const plan = dao.governanceCap(governanceCap.capId).updateMarket(escrow.id, {
    restPrice: DUMMY(0.03),
  });
  const tx = await plan.toTransaction(msAddr);
  const bytes = await tx.build({ client }); // ← serializable; hand these around out-of-band

  const sigA = (await a.signTransaction(bytes)).signature; // party A, now
  // … the bytes + sigA can sit in a DB / be sent over the wire; no live process …
  const sigB = (await b.signTransaction(bytes)).signature; // party B, later, elsewhere

  const combined = msPk.combinePartialSignatures([sigA, sigB]); // anyone can assemble
  const res = await executeSigned(client, toBase64(bytes), [combined]); // …and submit
  const dist = await plan.decode(res); // typed result, exactly as `.send()` would give
  console.log('② distributed (toTransaction → sign apart → combine → executeSigned) — digest', dist.digest);

  // verify the second change landed on chain.
  const after = await dao.escrow(escrow.id);
  console.log(`   floor →`, String(after.floorPrice), `(started at ${String(escrow.floorPrice)})`);

  // ── ③ the treasury EARNS: a renter pays, the tenancy settles ──
  // Governing is only half a treasury; the other half is banking income. The
  // operator stands in as a renter, pays the (now 0.03) floor, the tenure elapses,
  // and the tenancy settles its earnings into the inbox the multisig holds.
  console.log('\n③ a renter pays the floor; wait out the tenure; settle (permissionless)…');
  const seat = await op.escrow(escrow.id);
  const rentCap = await seat.rent({ tenures: 1 }).send();
  console.log('   rented for', String(rentCap.receipt!.paid), '— until', rentCap.receipt!.expiresAt.toISOString());
  await waitForChainTime(client, BigInt(rentCap.receipt!.expiresAt.getTime()));
  await seat.applyPendingTransitionStates().send(); // settles earnings into the inbox
  console.log('   tenancy settled — earnings are in the inbox the multisig holds');

  // ── ④ the multisig COLLECTS — the defining treasury action, SAME seam ──
  const earned = await dao.earningsInbox(earningsInbox.inboxId).collect().send();
  console.log('④ collect via 2-of-3 multisig —', earned.map((e) => String(e.amount)).join(', ') || '(nothing)');

  const governed = after.floorPrice.mist === DUMMY(0.03).mist;
  const collected = earned.length > 0 && earned.some((e) => e.amount.mist > 0n);
  console.log(
    governed && collected
      ? '\nALL PASS — the multisig closed the full treasury loop: GOVERN (sync + distributed) and COLLECT.'
      : `\nincomplete — governed=${governed} collected=${collected}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
