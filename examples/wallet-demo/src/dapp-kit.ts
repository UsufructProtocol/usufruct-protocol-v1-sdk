import { createDAppKit } from '@mysten/dapp-kit-react';
import { SuiGrpcClient } from '@mysten/sui/grpc';

const GRPC_URL = 'https://fullnode.testnet.sui.io:443';

// ONE client for both dapp-kit and the SDK: `walletExecutor` runs the wallet's
// signed bytes through this same client (so the result is enriched the SDK way).
export const client = new SuiGrpcClient({ network: 'testnet', baseUrl: GRPC_URL });

export const dAppKit = createDAppKit({
  networks: ['testnet'],
  createClient: () => client,
  autoConnect: true,
  storage: localStorage,
  storageKey: 'usufruct_wallet_demo',
});

// Register the instance type so the hooks infer correctly.
declare module '@mysten/dapp-kit-react' {
  interface Register {
    dAppKit: typeof dAppKit;
  }
}
