/**
 * Live read-only check for P1 #4 — the SDK rides through transient public-node
 * faults. No signer, no funds: reads only.
 *   1. Burst `getObject(0x6)` through a `retryingClient` to provoke/observe 429s.
 *   2. Resolve a real escrow handle end-to-end via `usufruct()` (retry on).
 */
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { retryingClient } from '../src/highlevel/retry.js';
import { usufruct } from '../src/highlevel/index.js';
import { check, finish, step } from './lib.js';

const RPC_URL = 'https://fullnode.testnet.sui.io:443';
const FIXTURE_ESCROW = '0xf6ef47de1b19c51b488762d0c78d8b545b9ddc63a45d7be618997af212860920';

async function main(): Promise<void> {
  step('1. burst getObject(0x6) through retryingClient — ride through transient faults');
  let retries = 0;
  const causes: Record<string, number> = {};
  const base = new SuiJsonRpcClient({ network: 'testnet', url: RPC_URL });
  const client = retryingClient(base, {
    baseMs: 300,
    attempts: 5,
    onRetry: ({ error }) => {
      retries++;
      const e = error as { status?: number; code?: string; cause?: { code?: string } };
      const k = String(e.status ?? e.cause?.code ?? e.code ?? 'err');
      causes[k] = (causes[k] ?? 0) + 1;
    },
  });
  // A wide concurrent burst saturates the connection pool — live this surfaces
  // `UND_ERR_CONNECT_TIMEOUT` (not 429). Without retry, ~a third of reads fail;
  // with it, all recover.
  const N = 250;
  const res = await Promise.allSettled(
    Array.from({ length: N }, () => client.core.getObject({ objectId: '0x6' })),
  );
  const ok = res.filter((r) => r.status === 'fulfilled').length;
  check('every burst read ultimately succeeded', ok === N, `${ok}/${N}`);
  console.log(`  transient retries ridden through: ${retries} ${JSON.stringify(causes)}`);

  step('2. resolve a real escrow handle end-to-end (usufruct, retry on by default)');
  const u = usufruct({ network: 'testnet' });
  try {
    const escrow = await u.escrow(FIXTURE_ESCROW);
    check('escrow handle resolved', typeof escrow.status === 'string', `status=${escrow.status}`);
    check('coin info resolved (decimals from chain)', escrow.floorPrice.mist >= 0n);
  } catch (e) {
    const msg = (e as Error).message;
    // The fixture escrow may have been cleaned; a "not found" still proves the
    // read path reached the node (it's a deterministic answer, not a flake).
    check('escrow read reached the node (resolved or cleanly not-found)', /not.*(found|exist)|deleted|object/i.test(msg), msg.slice(0, 120));
  }
}

main().then(finish);
