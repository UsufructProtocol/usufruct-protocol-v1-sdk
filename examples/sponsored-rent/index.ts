/**
 * PROBE D — sponsored rent: does the `Executor` seam express sender ≠ gas payer?
 *
 * A gas station: a user with ZERO SUI rents an asset; a sponsor pays the gas. The
 * user still pays the rent (in DUMMY) and authorizes the action — only the gas is
 * someone else's. The transaction carries two signatures: the user (sender) and
 * the sponsor (gas owner).
 *
 * Hypothesis: this fits the EXISTING write seam with ZERO core changes — a
 * `sponsoredExecutor` whose `execute` sets the gas owner to the sponsor and
 * gathers BOTH signatures, then submits via the exported `executeSigned`. Same
 * lesson as the wallet/multisig probes: the SDK executes + enriches; only the
 * *signing arrangement* changes.
 *
 * Finding (see README): it holds. The user's SUI balance stays 0 across the rent —
 * the gas came entirely from the sponsor — and the UsufructCap is the user's.
 *
 * Run from the monorepo root:  npx tsx examples/sponsored-rent/index.ts
 * (needs a funded testnet signer for the operator/sponsor: SUI_PRIVATE_KEY env, or
 *  the `usufruct-sdk-testnet` CLI alias.)
 */
import type { Signer } from '@mysten/sui/cryptography';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Transaction } from '@mysten/sui/transactions';
import { toBase64 } from '@mysten/sui/utils';
import { coinTag, executeSigned, signerExecutor, usufruct, type Executor } from '@usufruct-protocol/sdk';
import { loadSigner } from '../../scripts/lib.js';

const GRPC_URL = 'https://fullnode.testnet.sui.io:443';
const SUI_COIN = '0x2::coin::Coin<0x2::sui::SUI>';
const DUMMY_PKG = '0xa72e830fcb3e688ab3c20ff3cbd0a149cd1b58715709905585e75eb18317a52a';
const DUMMY_COIN_PKG = '0x97fb7c77162e3edf6a44815ec9eb29b69f9a43747dfb1c1019a7fc5501e2ad96';
const DUMMY_COIN_TREASURY = '0xccee2bc2227913f441c7544892cf5d220880cbc0c55be8733b4b6777def976bc';
const DUMMY = coinTag({ type: `${DUMMY_COIN_PKG}::dummy_coin::DUMMY_COIN`, decimals: 9, symbol: 'DUMMY' });

const client = new SuiGrpcClient({ network: 'testnet', baseUrl: GRPC_URL });

// ─────────────────────────────────────────────────────────────────────────────
// THE PROBE: a gas station as a first-class Executor. The user is the sender +
// authorizer; the sponsor owns the gas. `execute` gathers BOTH signatures and
// submits via the SDK's exported `executeSigned`. ~12 lines, zero core changes.
// ─────────────────────────────────────────────────────────────────────────────
function sponsoredExecutor(user: Signer, sponsor: Signer): Executor {
  return {
    address: user.toSuiAddress(), // identity = the user (the sender), not the gas payer
    execute: async (tx) => {
      tx.setSenderIfNotSet(user.toSuiAddress());
      tx.setGasOwner(sponsor.toSuiAddress()); // ← gas comes from the sponsor, not the sender
      const bytes = await tx.build({ client }); // gas payment auto-resolves from the gas owner
      const userSig = (await user.signTransaction(bytes)).signature; // authorizes the action
      const sponsorSig = (await sponsor.signTransaction(bytes)).signature; // pays the gas
      return executeSigned(client, toBase64(bytes), [userSig, sponsorSig]);
    },
  };
}

/** How many SUI coin objects an address owns (0 ⇒ it cannot pay its own gas). */
async function suiCoinCount(owner: string): Promise<number> {
  const page = await client.core.listOwnedObjects({ owner, type: SUI_COIN, limit: 50 });
  return page.objects.length;
}

async function main() {
  const operator = loadSigner(); // funded: lists the asset AND sponsors the gas
  console.log('operator / sponsor', operator.toSuiAddress());

  // 1. operator lists an asset as a DUMMY-priced market.
  const op = usufruct({ client, signer: operator });
  const mintTx = new Transaction();
  const sword = mintTx.moveCall({ target: `${DUMMY_PKG}::dummy_asset::mint` });
  mintTx.transferObjects([sword], operator.toSuiAddress());
  const mintRes = await signerExecutor(client, operator).execute(mintTx);
  const swordId = mintRes.effects!.changedObjects!.find(
    (o) => o.idOperation === 'Created' && mintRes.objectTypes?.[o.objectId]?.includes('::dummy_asset::DummyAsset'),
  )!.objectId;
  const { escrow } = await op
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
  console.log('escrow', escrow.id, '· floor', String(escrow.floorPrice));

  // 2. a brand-new user funded with DUMMY ONLY — NO SUI, so it cannot pay gas.
  const user = Ed25519Keypair.generate();
  const fundTx = new Transaction();
  const dummy = fundTx.moveCall({
    target: `${DUMMY_COIN_PKG}::dummy_coin::mint`,
    arguments: [fundTx.object(DUMMY_COIN_TREASURY), fundTx.pure.u64(1_000_000_000n)],
  });
  fundTx.transferObjects([dummy], user.toSuiAddress()); // DUMMY only — deliberately no SUI
  await signerExecutor(client, operator).execute(fundTx);
  const before = await suiCoinCount(user.toSuiAddress());
  console.log(`\nuser ${user.toSuiAddress()}`);
  console.log(`  funded with 1.0 DUMMY · SUI coins owned: ${before}  ← cannot pay its own gas`);

  // 3. THE WRITE: the gasless user rents, the sponsor pays gas. `.send()` is
  //    identical to any other path — the executor hides the two-party signing.
  const u = usufruct({ client });
  u.connect(sponsoredExecutor(user, operator));
  const cap = await u.escrow(escrow.id).then((e) => e.rent({ tenures: 1 }).send());
  console.log('\n✓ rent sent by the gasless user, gas sponsored — usufructCap', cap.id);
  console.log(`  paid ${String(cap.receipt!.paid)} (in DUMMY, by the user)`);

  // 4. proof: the user STILL owns zero SUI — every bit of gas came from the sponsor.
  const after = await suiCoinCount(user.toSuiAddress());
  console.log(`\nuser SUI coins after: ${after} (was ${before})`);
  console.log(
    cap.id && after === 0
      ? '\nALL PASS — a user with zero SUI transacted; the sponsor paid gas through the Executor seam.'
      : `\nincomplete — cap=${!!cap.id} userSuiCoins=${after}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
