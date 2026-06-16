/**
 * The `Escrow` handle (Layer 2) — the hub: one batched read snapshot, the
 * signer's resolved role, and (Phase C) the permissionless writes.
 *
 * One `await` (`u.escrow(id)`) resolves state, the curated read getters at a
 * single time `t`, *and* the signer's role here — so everything below is sync.
 * The reads are a snapshot at `t` (the fetch time); for live values use the
 * kernel `reader` (exposed) or, later, `watch`/`priceCurve`.
 */
import { Transaction } from '@mysten/sui/transactions';
import { id as toId, mist, tenureCount } from '../primitives/brand.js';
import { createReader, type Reader } from '../read/reader.js';
import { applyPendingTransitionStates } from '../actions/apply.js';
import { rent as rentAction } from '../actions/rent.js';
import { escrowVersionChanges } from '../primitives/grpc-source.js';
import { createCap, type UsufructCap } from './cap.js';
import { sourceCoin } from './coins.js';
import type { HandleCtx } from './ctx.js';
import { createGovernanceCap, type GovernanceCap } from './governanceCap.js';
import { createInbox, type EarningsInbox } from './inbox.js';
import { NotConnected, UsufructError, mapAbort } from './errors.js';
import { toHistoryEvent, type HistoryEvent } from './history.js';
import type { UsufructCapRecord } from './listings.js';
import { createdIdByType, execute } from './send.js';
import { coinTag, price, type CoinTag, type Price } from './value.js';
import { resolveCoinInfo } from './coinmeta.js';
import { resolveWhen } from './clock.js';
import { resolveRole } from './role.js';
import { fetchTypeArgs } from './typeargs.js';
import type { When } from './usufruct.js';

export type EscrowStatus = 'idle' | 'descent' | 'occupied' | 'demand' | 'retired';

/** The hub handle. Reads are sync getters off one fetch; writes return handles. */
export interface Escrow {
  readonly id: string;
  readonly assetType: string;
  readonly coinType: string;
  /** The escrow's payment coin as a tag (resolved decimals/symbol) — to express
   *  amounts in it, e.g. `pay: escrow.coin(0.6)`. The coin is fixed at integrate. */
  readonly coin: CoinTag;

  // reads — a snapshot at the fetch time `t`
  readonly status: EscrowStatus;
  /** Free to take now at the floor (idle/descent), without displacing a tenant. */
  readonly isAvailable: boolean;
  readonly floorPrice: Price;
  readonly accruedCredit: Price;
  readonly expiresAt: Date | null;

  // identities — which objects relate to this escrow (data, any holder)
  readonly governanceCapId: string;
  readonly earningsInboxId: string;
  readonly feeInboxId: string;
  readonly activeUsufructCapId: string | null;

  // always-liquid demand state — a challenger has bid on the occupied escrow.
  // Non-null only while `status === 'demand'`; otherwise all null / false.
  /** A bid is outstanding and a handover window is running (`status === 'demand'`). */
  readonly isChallenged: boolean;
  /** The pending challenger's `UsufructCap`, waiting to take over. */
  readonly pendingUsufructCapId: string | null;
  /** The pending challenger's address. */
  readonly pendingUsufructuaryAddr: string | null;
  /** When the sitting tenant's handover protection ends (the bid can then settle). */
  readonly handoverExpiresAt: Date | null;

  // the signer's holdings here, resolved in the same fetch (possession = role)
  readonly canRent: boolean;
  readonly canBorrow: boolean;
  readonly canGovern: boolean;
  /** The active `UsufructCap`, if the signer holds it (sync). */
  readonly usufructCap: UsufructCap | null;
  /** The `GovernanceCap`, if the signer holds it (sync). */
  readonly governanceCap: GovernanceCap | null;
  /** The `EarningsInbox`, if the signer holds it (sync). */
  readonly earningsInbox: EarningsInbox | null;

  /**
   * Acquire the right of use for `tenures`. The only decision is the **amount**:
   * `pay` (a `Price`) defaults to the floor (`floorPrice × tenures`); pay more to
   * **overpay** — the surplus becomes stake (more credit/time). The coin is the
   * escrow's own, drawn from your balance — you never name it. Returns the cap.
   *
   *   escrow.rent({ tenures: 1 })                    // pay the floor
   *   escrow.rent({ tenures: 1, pay: escrow.coin(2) }) // overpay → extra stake
   */
  rent(args: { tenures: number; pay?: Price }): Promise<UsufructCap>;

  /**
   * Permissionless keeper: materialize the pending lazy transitions (tenure
   * expiry, auction expiry, handover) — the Move `apply_pending_transition_states`.
   * Rarely called by hand; the next interaction (e.g. a rent) applies them anyway.
   */
  applyPendingTransitionStates(): Promise<{ digest: string }>;

  /**
   * The roster of every `UsufructCap` this escrow has minted (active, pending, or
   * long-burned) — object-centric, the escrow answering for itself, from
   * `UsufructCapMinted` events. (The reverse, cap→escrow, is on-chain: a
   * `UsufructCap` stores its `escrow_identity`, so `usufructCap.escrow()` needs no
   * events.) Decode-free records. Needs `graphql`.
   */
  usufructCaps(): Promise<UsufructCapRecord[]>;

  /**
   * This escrow's lifecycle as a time-ordered list of typed `HistoryEvent`s —
   * integration, policy, rentals, bids, displacements, settlements, governance,
   * teardown. Built on the indexer's escrow timeline (every escrow-keyed event,
   * decoded and merged).
   *
   * The timeline scans each event type and filters by escrow (GraphQL can't match
   * a payload field), so on a busy/long-lived package the public endpoint may choke
   * — **bound it** with `afterCheckpoint` (the escrow's events all postdate its
   * integration). `sender` narrows to one actor. Needs `graphql`.
   */
  history(opts?: {
    sender?: string;
    afterCheckpoint?: number;
    beforeCheckpoint?: number;
  }): Promise<HistoryEvent[]>;

  /**
   * React to this escrow's changes live: `onChange` runs with a **fresh snapshot**
   * each time the on-chain object changes, then a `stop()`. **Server-push** over
   * gRPC when available (the checkpoint firehose signals the version change —
   * decode-free, just `object_id`+`version` — and we re-resolve the decode-free
   * handle); falls back to version-polling (`intervalMs`, default 3s) only when no
   * gRPC client is configured. The basis for keepers — settle on expiry,
   * counter-bid on a challenge.
   */
  watch(onChange: (escrow: Escrow) => void, opts?: { intervalMs?: number }): () => void;
  /**
   * Resolve once a snapshot satisfies `predicate` — *wait for an event* expressed
   * as the state it produces, e.g. a challenger: `escrow.waitFor(e => e.isChallenged)`.
   * Checks the current state first, then on each change. Optional `timeoutMs`.
   */
  waitFor(
    predicate: (escrow: Escrow) => boolean,
    opts?: { intervalMs?: number; timeoutMs?: number },
  ): Promise<Escrow>;

  /** Escape hatch: the drift-free kernel reader for this escrow (all ~80 views). */
  readonly reader: Reader;
}

async function resolveStatus(reader: Reader): Promise<EscrowStatus> {
  const [retired, occupied, demand, descending] = await Promise.all([
    reader.isRetired(),
    reader.isOccupied(),
    reader.isDemand(),
    reader.isDescending(),
  ]);
  if (retired) return 'retired';
  if (occupied) return 'occupied';
  if (demand) return 'demand';
  if (descending) return 'descent';
  return 'idle';
}

/** Build an `Escrow` handle: fetch state + read getters at `t` + role, all batched. */
export async function createEscrow(ctx: HandleCtx, idStr: string, at?: When): Promise<Escrow> {
  const { client, packageId, signer, assetSchema } = ctx;
  const owner = signer?.toSuiAddress() ?? null;
  const escrowId = toId<'Escrow'>(idStr);

  // Type args come from the object's type string — no decode, no asset schema.
  const [[assetType, coinType], t] = await Promise.all([fetchTypeArgs(client, escrowId), resolveWhen(client, at)]);

  const reader = createReader(client, {
    packageId,
    escrowId,
    typeArguments: [assetType, coinType],
    ...(assetSchema ? { assetSchema } : {}),
  });

  const [floorMist, status, expiryMs, activeCapId, govCapId, inboxId, feeInboxId] = await Promise.all([
    reader.floorPriceMist(t),
    resolveStatus(reader),
    reader.tenureExpiryMs(),
    reader.activeUsufructCapId(),
    reader.governanceCapId(),
    reader.earningsInboxId(),
    reader.feeInboxId(),
  ]);

  // `accruedCreditMist` aborts on a non-rented escrow — read it only when rented.
  // The demand-state views (pending challenger + handover) only exist in `demand`.
  const rented = status === 'occupied' || status === 'demand';
  const challenged = status === 'demand';
  const [accruedMist, role, pendingCapId, pendingAddr, handoverMs] = await Promise.all([
    rented ? reader.accruedCreditMist(t) : Promise.resolve(mist(0n)),
    resolveRole(client, packageId, owner, activeCapId, govCapId, inboxId),
    challenged ? reader.pendingUsufructCapId() : Promise.resolve(null),
    challenged ? reader.pendingUsufructuaryAddr() : Promise.resolve(null),
    challenged ? reader.handoverExpiryMs() : Promise.resolve(null),
  ]);

  // Real decimals/symbol from CoinMetadata (cached) — assuming 9 renders any
  // non-SUI coin wrong (e.g. 6-decimal USDC). Keeps the handle coin-agnostic.
  const coin = await resolveCoinInfo(client, coinType);
  const typeArguments: [string, string] = [assetType, coinType];
  async function applyPending(): Promise<{ digest: string }> {
    if (signer == null) throw new NotConnected('applyPendingTransitionStates requires a signer (it submits a tx)');
    const tx = new Transaction();
    applyPendingTransitionStates().toPtb(tx, { pkg: { packageId }, escrowId, typeArguments });
    const res = await execute(client, tx, signer).catch(mapAbort);
    return { digest: res.digest };
  }

  const usufructCap: UsufructCap | null = role.capId
    ? createCap(ctx, {
        capId: role.capId,
        escrowId: idStr,
        typeArguments,
        receipt: null,
      })
    : null;
  const governanceCap: GovernanceCap | null = role.governs ? createGovernanceCap(ctx, govCapId) : null;
  const earningsInbox: EarningsInbox | null = role.holdsEarnings ? createInbox(ctx, inboxId, 'earnings') : null;

  async function rent(args: { tenures: number; pay?: Price }): Promise<UsufructCap> {
    if (signer == null || owner == null) {
      throw new NotConnected('rent requires a signer; pass one to usufruct() or u.connect()');
    }
    const count = BigInt(args.tenures);
    const floorTotal = floorMist * count; // snapshot floor at fetch time `t`
    // The decision: pay the floor (default) or overpay (surplus → stake). The
    // coin is the escrow's own — auto-sourced; the renter only chooses the number.
    const paidMist = args.pay ? args.pay.mist : floorTotal;

    const tx = new Transaction();
    const payment = await sourceCoin(tx, client, owner, { coinType, amountMist: paidMist });
    const minted = rentAction({ tenures: tenureCount(count) }).toPtb(tx, {
      pkg: { packageId },
      escrowId,
      payment,
      typeArguments,
    });
    tx.transferObjects([minted], owner);

    const res = await execute(client, tx, signer).catch(mapAbort);
    const capId = createdIdByType(res, '::usufruct_cap::UsufructCap');
    if (capId == null) throw new Error(`rent: no UsufructCap created (digest ${res.digest})`);

    const expiry = await reader.tenureExpiryMs();
    return createCap(ctx, {
      capId,
      escrowId: idStr,
      typeArguments,
      receipt: {
        paid: price(paidMist, coin),
        expiresAt: new Date(Number(expiry ?? 0n)),
        digest: res.digest,
      },
    });
  }

  async function usufructCaps(): Promise<UsufructCapRecord[]> {
    if (ctx.indexer == null) {
      throw new UsufructError('usufructCaps requires a GraphQL endpoint — pass `graphql` to usufruct()');
    }
    const type = `${packageId}::usufruct_cap::UsufructCapMinted`;
    const out: UsufructCapRecord[] = [];
    const seen = new Set<string>();
    for await (const ev of ctx.indexer.events({ type })) {
      if (ev.escrowId !== idStr) continue;
      const capId = String(ev.json['usufruct_cap_id']);
      if (seen.has(capId)) continue;
      seen.add(capId);
      out.push({
        usufructCapId: capId,
        escrowId: idStr,
        usufructuary: String(ev.json['usufructuary_address']),
        mintedAt: ev.timestamp ? new Date(ev.timestamp) : null,
      });
    }
    return out;
  }

  async function history(opts?: {
    sender?: string;
    afterCheckpoint?: number;
    beforeCheckpoint?: number;
  }): Promise<HistoryEvent[]> {
    if (ctx.indexer == null) {
      throw new UsufructError('history requires a GraphQL endpoint — pass `graphql` to usufruct()');
    }
    const events = await ctx.indexer.escrowTimeline(escrowId, {
      ...(opts?.sender !== undefined ? { sender: opts.sender } : {}),
      ...(opts?.afterCheckpoint !== undefined ? { afterCheckpoint: opts.afterCheckpoint } : {}),
      ...(opts?.beforeCheckpoint !== undefined ? { beforeCheckpoint: opts.beforeCheckpoint } : {}),
    });
    return events.map(toHistoryEvent);
  }

  function watch(onChange: (e: Escrow) => void, watchOpts?: { intervalMs?: number }): () => void {
    let stopped = false;
    // Re-resolve the decode-free handle and hand it to the callback. A transient
    // read flake (truncated devInspect) skips this tick — it must NOT end the
    // watch, or a `waitFor` would hang forever.
    const emit = async () => {
      try {
        const snap = await createEscrow(ctx, idStr);
        if (!stopped) onChange(snap);
      } catch {
        /* transient resolve flake — skip, keep watching */
      }
    };

    // PUSH: a gRPC client streams the escrow's version changes (decode-free — just
    // object_id + version off the checkpoint firehose). On each, re-resolve the
    // decode-free handle. No asset schema, no polling latency.
    const grpc = ctx.grpcClient;
    if (grpc) {
      const controller = new AbortController();
      void (async () => {
        try {
          await emit(); // initial snapshot, so waitFor can match the current state
          const changes = escrowVersionChanges(grpc, escrowId, controller.signal)[Symbol.asyncIterator]();
          while (!stopped) {
            if ((await changes.next()).done) break;
            await emit();
          }
        } catch {
          /* aborted or stream error */
        }
      })();
      return () => {
        stopped = true;
        controller.abort();
      };
    }

    // POLL fallback (no gRPC available): version-poll the object.
    const intervalMs = watchOpts?.intervalMs ?? 3000;
    let lastVersion: string | null = null;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    void (async () => {
      while (!stopped) {
        try {
          const { object } = await client.core.getObject({ objectId: escrowId });
          const v = String(object.version);
          if (v !== lastVersion) {
            lastVersion = v;
            await emit();
          }
        } catch {
          /* transient read error — keep polling */
        }
        if (!stopped) await sleep(intervalMs);
      }
    })();
    return () => {
      stopped = true;
    };
  }

  function waitFor(
    predicate: (e: Escrow) => boolean,
    waitOpts?: { intervalMs?: number; timeoutMs?: number },
  ): Promise<Escrow> {
    return new Promise<Escrow>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const stop = watch(
        (e) => {
          if (predicate(e)) {
            stop();
            if (timer) clearTimeout(timer);
            resolve(e);
          }
        },
        waitOpts?.intervalMs !== undefined ? { intervalMs: waitOpts.intervalMs } : undefined,
      );
      if (waitOpts?.timeoutMs !== undefined) {
        timer = setTimeout(() => {
          stop();
          reject(new Error(`waitFor timed out after ${waitOpts.timeoutMs}ms`));
        }, waitOpts.timeoutMs);
      }
    });
  }

  return {
    id: idStr,
    assetType: assetType,
    coinType: coinType,
    coin: coinTag(coin),
    status,
    isAvailable: status === 'idle' || status === 'descent',
    floorPrice: price(floorMist, coin),
    accruedCredit: price(accruedMist, coin),
    expiresAt: expiryMs == null ? null : new Date(Number(expiryMs)),
    governanceCapId: govCapId,
    earningsInboxId: inboxId,
    feeInboxId,
    activeUsufructCapId: activeCapId,
    isChallenged: challenged,
    pendingUsufructCapId: pendingCapId,
    pendingUsufructuaryAddr: pendingAddr,
    handoverExpiresAt: handoverMs == null ? null : new Date(Number(handoverMs)),
    canRent: owner != null && status !== 'retired',
    canBorrow: role.capId != null,
    canGovern: role.governs,
    usufructCap,
    governanceCap,
    earningsInbox,
    rent,
    applyPendingTransitionStates: applyPending,
    usufructCaps,
    history,
    watch,
    waitFor,
    reader,
  };
}
