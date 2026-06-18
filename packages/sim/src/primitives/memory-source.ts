/**
 * In-memory `Source` (SPEC §4.4 / §6.5 / §7) — the off-chain testbed. A local
 * store of `EscrowState` that `Action.step` advances. Because the rest of the
 * SDK does not know which `Source` it was given, the *same* views and actions
 * that run against the chain run here — the whole lifecycle
 * (integrate → rent → apply → retire → claim) in RAM: instant, no gas, no
 * 90 s tenures, with the clock as an explicit argument (`t: Ms`, §3) so time can
 * be jumped freely.
 *
 * Reads come from the store; writes come from `apply*`, which feed a step's
 * successor back in. Subscriptions are event-driven (no polling — it is memory).
 * `query` answers what `EscrowState` alone can: `all`, `byAssetType`, and
 * `byUsufructuary` (the active tenant's address). `byGovernor` is not derivable
 * from an escrow's state — the governor address lives on the owned
 * `GovernanceCap`, not in the escrow — so it throws, the same honest limit
 * `chainSource` has over the core API.
 */
import type { Id, Ms } from '@usufruct-protocol/sdk/primitives/brand.js';
import { activeUsufructuaryAddr } from '../views/identity.js';
import type { OriginAction, TerminalAction, TransitionAction } from './action.js';
import type { AssetSchema, uidAssetSchema } from '@usufruct-protocol/sdk/primitives/state.js';
import type { EscrowState } from './state.js';
import { channel, type Predicate, type SubscribeOpts } from '@usufruct-protocol/sdk/primitives/source.js';

/** Canonical id form (`0x`-insensitive), matching the other sources. */
function normId(s: string): string {
  return s.replace(/^0x/, '').toLowerCase().replace(/^0+/, '');
}

/**
 * An in-memory store of decoded `EscrowState` (the mirror's testbed), plus a
 * control surface to seed states and advance them through `Action.step`. It is
 * `Source`-shaped — `fetch`/`subscribe`/`query` — but, being the mirror's own
 * testbed, it yields the *decoded* `EscrowState` directly (the chain `Source`
 * yields raw snapshots that the mirror decodes; here the store already holds
 * decoded state, so it skips the round-trip).
 */
export interface MemorySource<
  A extends AssetSchema = typeof uidAssetSchema,
  C extends string = string,
> {
  readonly fetch: (id: Id<'Escrow'>) => Promise<EscrowState<A, C>>;
  readonly subscribe: (
    id: Id<'Escrow'>,
    opts?: SubscribeOpts,
  ) => AsyncIterable<EscrowState<A, C>>;
  readonly query: (predicate: Predicate) => AsyncIterable<EscrowState<A, C>>;
  /**
   * Insert or replace an escrow's state (notifies subscribers). `governor`
   * tags it so `query({ byGovernor })` can find it — the governor address is
   * not part of `EscrowState` (it lives on the owned `GovernanceCap`), so it
   * must be supplied here.
   */
  set(state: EscrowState<A, C>, opts?: { governor?: string }): void;
  /** Drop an escrow from the store. */
  delete(escrowId: Id<'Escrow'>): void;
  has(escrowId: Id<'Escrow'>): boolean;
  readonly size: number;
  /** Apply a transition: `step(current, t)`, persist the successor, return its result. */
  apply<R, P>(escrowId: Id<'Escrow'>, action: TransitionAction<R, P, EscrowState<A, C>>, t: Ms): R;
  /** Apply an origin: `step(t)`, persist the new state under its `objectId`. */
  applyOrigin<R, P>(
    action: OriginAction<R, P, EscrowState<A, C>>,
    t: Ms,
  ): { state: EscrowState<A, C>; result: R };
  /** Apply a terminal: `step(current, t)`, delete the escrow (it is consumed), return its result. */
  applyTerminal<R, P>(escrowId: Id<'Escrow'>, action: TerminalAction<R, P, EscrowState<A, C>>, t: Ms): R;
}

/**
 * Build an in-memory `Source`, optionally seeded with initial states.
 */
export function memorySource<
  A extends AssetSchema = typeof uidAssetSchema,
  C extends string = string,
>(
  seed?: Iterable<EscrowState<A, C> | { state: EscrowState<A, C>; governor?: string }>,
): MemorySource<A, C> {
  // normId → { the state, a monotonic revision for subscribe dedupe, governor tag }.
  const store = new Map<string, { state: EscrowState<A, C>; rev: number; governor?: string }>();
  // normId → listeners woken on every change to that escrow.
  const listeners = new Map<string, Set<() => void>>();
  let revSeq = 0;

  const get = (escrowId: Id<'Escrow'>) => store.get(normId(escrowId));

  const notify = (n: string): void => {
    const ls = listeners.get(n);
    if (ls) for (const l of [...ls]) l();
  };

  const set = (state: EscrowState<A, C>, opts?: { governor?: string }): void => {
    const n = normId(state.objectId);
    store.set(n, {
      state,
      rev: ++revSeq,
      ...(opts?.governor !== undefined ? { governor: opts.governor } : {}),
    });
    notify(n);
  };

  for (const s of seed ?? []) {
    if ('objectId' in s) set(s);
    else set(s.state, s.governor !== undefined ? { governor: s.governor } : undefined);
  }

  const self: MemorySource<A, C> = {
    set,

    delete(escrowId) {
      store.delete(normId(escrowId));
    },

    has(escrowId) {
      return store.has(normId(escrowId));
    },

    get size() {
      return store.size;
    },

    fetch(escrowId) {
      const entry = get(escrowId);
      if (!entry) return Promise.reject(new Error(`escrow not found in memorySource: ${escrowId}`));
      return Promise.resolve(entry.state);
    },

    subscribe(escrowId, opts?: SubscribeOpts) {
      const n = normId(escrowId);
      const signal = opts?.signal;
      const out = channel<EscrowState<A, C>>();
      let lastRev = -1;

      const pump = (): void => {
        const entry = store.get(n);
        if (entry && entry.rev !== lastRev) {
          lastRev = entry.rev;
          out.push(entry.state);
        }
      };

      const ls = listeners.get(n) ?? new Set();
      ls.add(pump);
      listeners.set(n, ls);

      const stop = (): void => {
        ls.delete(pump);
        out.close();
      };
      if (signal?.aborted) stop();
      else signal?.addEventListener('abort', stop, { once: true });

      pump(); // emit the current state (if any) first
      return out;
    },

    async *query(predicate: Predicate) {
      for (const entry of store.values()) {
        if ('byGovernor' in predicate) {
          if (entry.governor != null && normId(entry.governor) === normId(predicate.byGovernor)) {
            yield entry.state;
          }
          continue;
        }
        if (matches(entry.state, predicate)) yield entry.state;
      }
    },

    apply(escrowId, action, t) {
      const entry = get(escrowId);
      if (!entry) throw new Error(`escrow not found in memorySource: ${escrowId}`);
      const { state, result } = action.step(entry.state, t);
      set(state);
      return result;
    },

    applyOrigin(action, t) {
      const { state, result } = action.step(t);
      set(state);
      return { state, result };
    },

    applyTerminal(escrowId, action, t) {
      const entry = get(escrowId);
      if (!entry) throw new Error(`escrow not found in memorySource: ${escrowId}`);
      const { result } = action.step(entry.state, t);
      self.delete(escrowId);
      return result;
    },
  };

  return self;
}

/**
 * Whether a stored state satisfies a state-derivable predicate. `byGovernor`
 * is handled by `query` against the seed-time tag (the governor isn't in
 * `EscrowState`), so it never reaches here.
 */
function matches(state: EscrowState<AssetSchema, string>, predicate: Predicate): boolean {
  if ('all' in predicate) return true;
  if ('byAssetType' in predicate) return normType(state.assetType) === normType(predicate.byAssetType);
  if ('byUsufructuary' in predicate) {
    const addr = activeUsufructuaryAddr(state, 0n as Ms);
    return addr != null && normId(addr) === normId(predicate.byUsufructuary);
  }
  return false; // byGovernor handled in query()
}

/** Compare Move type tags ignoring `0x`/short-form address differences. */
function normType(t: string): string {
  return t.replace(/0x0*/g, '0x').toLowerCase();
}
