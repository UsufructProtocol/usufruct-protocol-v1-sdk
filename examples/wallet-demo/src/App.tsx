import { useState } from 'react';
import { useCurrentAccount, useDAppKit } from '@mysten/dapp-kit-react';
import { ConnectButton } from '@mysten/dapp-kit-react/ui';
import { coinTag, usufruct, walletExecutor } from '@usufruct-protocol/sdk';
import { client } from './dapp-kit';

// dummy axes (free mint on testnet) — the asset to list and the payment coin.
const DUMMY_PKG = '0xa72e830fcb3e688ab3c20ff3cbd0a149cd1b58715709905585e75eb18317a52a';
const DUMMY_COIN_PKG = '0x97fb7c77162e3edf6a44815ec9eb29b69f9a43747dfb1c1019a7fc5501e2ad96';
const DUMMY = coinTag({
  type: `${DUMMY_COIN_PKG}::dummy_coin::DUMMY_COIN`,
  decimals: 9,
  symbol: 'DUMMY',
});

export function App() {
  const account = useCurrentAccount();
  const wallet = useDAppKit(); // its `signTransaction` IS our WalletSigner
  const [escrowId, setEscrowId] = useState('');
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const say = (m: string) => setLog((l) => [...l, m]);

  // A session whose default signer is the connected wallet: the wallet signs,
  // the SDK executes + enriches. No dapp-kit dependency inside the SDK — `wallet`
  // matches `WalletSigner` structurally.
  function session() {
    if (!account) throw new Error('connect a wallet first');
    const u = usufruct({ client });
    u.connect(walletExecutor(client, wallet, account));
    return u;
  }

  async function doIntegrate() {
    setBusy(true);
    try {
      const u = session();
      const owned = await client.core.listOwnedObjects({
        owner: account!.address,
        type: `${DUMMY_PKG}::dummy_asset::DummyAsset`,
        limit: 1,
      });
      const assetId = owned.objects[0]?.objectId;
      if (!assetId) {
        say('no DummyAsset owned — ask the funder to mint one to your address');
        return;
      }
      say(`① integrate asset ${assetId.slice(0, 12)}… — approve in Slush`);
      const { escrow, governanceCap, earningsInbox } = await u
        .integrate({
          asset: assetId,
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
      setEscrowId(escrow.id);
      say(`✓ escrow ${escrow.id}`);
      say(`  governanceCap ${governanceCap.capId}`);
      say(`  earningsInbox ${earningsInbox.inboxId}`);
    } catch (e) {
      say(`✗ ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function doRent() {
    setBusy(true);
    try {
      const u = session();
      if (!escrowId) {
        say('paste an escrow id (or integrate first)');
        return;
      }
      say(`② rent ${escrowId.slice(0, 12)}… — approve in Slush`);
      const handle = await u.escrow(escrowId);
      const cap = await handle.rent({ tenures: 1 }).send();
      say(`✓ usufructCap ${cap.id}`);
      say(`  paid ${cap.receipt?.paid} · until ${cap.receipt?.expiresAt.toISOString()}`);
    } catch (e) {
      say(`✗ ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 760, margin: '40px auto', padding: 16 }}>
      <h1>Usufruct × Slush — wallet write demo</h1>
      <p style={{ color: '#555' }}>
        Connect Slush, then trigger a write and watch how the transaction renders in the
        approval popup. The wallet only <b>signs</b>; the SDK <b>executes</b> + enriches.
      </p>
      <ConnectButton />
      {account && (
        <p>
          connected: <code>{account.address}</code>
        </p>
      )}
      <div style={{ display: 'flex', gap: 12, margin: '16px 0' }}>
        <button disabled={!account || busy} onClick={doIntegrate}>
          ① Integrate (list an asset)
        </button>
        <button disabled={!account || busy} onClick={doRent}>
          ② Rent 1 tenure
        </button>
      </div>
      <input
        placeholder="escrow id to rent (auto-filled after integrate)"
        value={escrowId}
        onChange={(e) => setEscrowId(e.target.value)}
        style={{ width: '100%', padding: 8, fontFamily: 'monospace', boxSizing: 'border-box' }}
      />
      <pre
        style={{
          background: '#0b0b0b',
          color: '#3ad900',
          padding: 12,
          marginTop: 16,
          minHeight: 96,
          borderRadius: 6,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
        }}
      >
        {log.join('\n') || '(log)'}
      </pre>
    </main>
  );
}
