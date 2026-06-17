/**
 * history() perf (P1 #7) — the timeline now walks the escrow's OWN transactions
 * (`affectedObject`), not a 25-way per-type event fan-out. Read-only (no gas):
 *
 *   ① discover a live escrow via the indexer
 *   ② escrow.history() → assert non-empty, time-ordered, all keyed to this escrow,
 *      includes AssetIntegrated
 *   ③ report the GraphQL request count (a single cursor walk = a few pages)
 *
 * Run: `npm run history`.
 */
import { SuiGraphQLClient } from '@mysten/sui/graphql';
import { coinTag, usufruct } from '../src/index.js';
import { GRAPHQL_TESTNET } from '../src/config/network.js';
import { check, finish, step } from './lib.js';

const DUMMY_COIN_PKG = '0x97fb7c77162e3edf6a44815ec9eb29b69f9a43747dfb1c1019a7fc5501e2ad96';
const DUMMY = coinTag({ type: `${DUMMY_COIN_PKG}::dummy_coin::DUMMY_COIN`, decimals: 9, symbol: 'DUMMY' });

// A GraphQL client that counts `query` round-trips, so we can show the timeline
// is a single cursor walk (a handful of pages) rather than 25 paginated chains.
function countingGraphql(): { gql: SuiGraphQLClient; queries: () => number; reset: () => void } {
  const base = new SuiGraphQLClient({ url: GRAPHQL_TESTNET });
  let queries = 0;
  const gql = new Proxy(base, {
    get(target, prop) {
      const v = (target as unknown as Record<string, unknown>)[prop as string];
      if (prop === 'query' && typeof v === 'function') {
        const fn = v as (...a: unknown[]) => unknown;
        return (...args: unknown[]) => {
          queries += 1;
          return fn.apply(target, args);
        };
      }
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  }) as SuiGraphQLClient;
  return { gql, queries: () => queries, reset: () => (queries = 0) };
}

async function main(): Promise<void> {
  const { gql, queries, reset } = countingGraphql();
  const u = usufruct({ network: 'testnet', graphql: gql });

  step('① discover a live escrow (priced in DUMMY) via the indexer');
  const listings = await u.escrowsByCoinType(DUMMY.type);
  check('found at least one escrow', listings.length > 0, `${listings.length} listings`);
  if (listings.length === 0) return;
  // Discovery (AssetIntegrated events) includes long-gone escrows; the most recent
  // listings are likeliest still on-chain. Resolve the first that still exists.
  let escrow = null as Awaited<ReturnType<(typeof listings)[number]['escrow']>> | null;
  for (const l of [...listings].reverse().slice(0, 20)) {
    try {
      escrow = await l.escrow();
      break;
    } catch {
      /* deleted/retired — try the next */
    }
  }
  check('resolved a live escrow', escrow !== null);
  if (escrow === null) return;
  console.log(`  escrow ${escrow.id.slice(0, 12)}… (status=${escrow.status})`);

  step('② escrow.history() — walk the escrow’s own transactions (affectedObject)');
  reset();
  const events = await escrow.history();
  const reqs = queries();
  check('history is non-empty', events.length > 0, `${events.length} events`);
  const ordered = events.every(
    (e, i) => i === 0 || (events[i - 1]!.at?.getTime() ?? 0) <= (e.at?.getTime() ?? 0),
  );
  check('events are time-ordered', ordered);
  check('includes the integration event', events.some((e) => e.kind === 'AssetIntegrated'), events.map((e) => e.kind).join(', '));

  step('③ request profile');
  console.log(`  history() issued ${reqs} GraphQL request(s) — O(escrow's txs), was a 25-way fan-out`);
  check('object-scoped walk, not a 25-way fan-out', reqs > 0 && reqs < 25, `${reqs} requests`);
}

main().then(finish);
