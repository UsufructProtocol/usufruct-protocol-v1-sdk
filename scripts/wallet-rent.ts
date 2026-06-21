/**
 * Headless validation of `walletExecutor` against testnet — the "wallet only
 * SIGNS, the SDK EXECUTES + enriches" path.
 *
 * A node `WalletSigner` stands in for a browser wallet: it builds the tx to bytes
 * and signs with a keypair — structurally exactly what `@mysten/dapp-kit`'s
 * `signTransaction` returns (`{ bytes, signature }`). This proves the RICH decodes
 * work through the wallet path (`integrate` → 3 created ids, `rent` → cap id):
 * the enriched `ExecResult` (`effects` + `objectTypes`) is produced by the SDK's
 * own execute, even though the wallet never sees `include`. The browser half (how
 * Slush renders the tx) is a separate manual demo — this is the machine half.
 *
 * Run: npm run wallet
 */
import { Transaction } from '@mysten/sui/transactions';
import { coinTag, usufruct, walletExecutor, type WalletSigner } from '@usufruct-protocol/sdk';
import { check, createdId, finish, loadSigner, makeClient, rateLimited, send, step } from './lib.js';

// dummy axes (free mint) — the asset to list and the payment coin.
const DUMMY_PKG = '0xa72e830fcb3e688ab3c20ff3cbd0a149cd1b58715709905585e75eb18317a52a';
const DUMMY_COIN_PKG = '0x97fb7c77162e3edf6a44815ec9eb29b69f9a43747dfb1c1019a7fc5501e2ad96';
const DUMMY = coinTag({ type: `${DUMMY_COIN_PKG}::dummy_coin::DUMMY_COIN`, decimals: 9, symbol: 'DUMMY' });

const client = rateLimited(makeClient());
const kp = loadSigner();

// A browser-wallet stand-in: build the tx to bytes, sign with the keypair. This is
// structurally what @mysten/dapp-kit's signTransaction does — the SDK only ever
// sees `{ bytes, signature }`, never the keypair. The wallet builds with its OWN
// client (raw, unwrapped — like a real wallet's configured client), not the SDK's.
const walletClient = makeClient();
const wallet: WalletSigner = {
  signTransaction: async ({ transaction }) => {
    transaction.setSenderIfNotSet(kp.toSuiAddress());
    const built = await transaction.build({ client: walletClient });
    return kp.signTransaction(built);
  },
};

async function main() {
  step('setup — mint a DummyAsset to list (boilerplate, raw signer)');
  const tx = new Transaction();
  const sword = tx.moveCall({ target: `${DUMMY_PKG}::dummy_asset::mint` });
  tx.transferObjects([sword], kp.toSuiAddress());
  const swordId = createdId(await send(client, tx, kp), '::dummy_asset::DummyAsset');
  check('asset minted', !!swordId, swordId);

  // The point: drive every write through the WALLET executor, not a held Signer.
  const u = usufruct({ client });
  u.connect(walletExecutor(client, wallet, { address: kp.toSuiAddress() }));
  check('u.address resolved from wallet account', u.address === kp.toSuiAddress(), u.address ?? '(null)');

  step('① integrate via walletExecutor — rich decode: 3 created ids');
  const { escrow, governanceCap, earningsInbox } = await u.write
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
  check('escrow resolved', !!escrow.id, escrow.id);
  check('governanceCap resolved', !!governanceCap.capId, governanceCap.capId);
  check('earningsInbox resolved', !!earningsInbox.inboxId, earningsInbox.inboxId);

  step('② rent via walletExecutor — rich decode: cap id + receipt');
  const handle = await u.nav.escrow(escrow.id);
  const cap = await handle.write.rent({ tenures: 1 }).send();
  check('usufructCap minted (id decoded via wallet path)', !!cap.id, cap.id);
  check('receipt.paid present', !!cap.receipt?.paid, String(cap.receipt?.paid));

  finish();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
