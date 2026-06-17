/**
 * The `Escrow` handle (Layer 2) — the hub: one batched read snapshot, the
 * signer's resolved role, and (Phase C) the permissionless writes.
 *
 * One `await` (`u.escrow(id)`) resolves state, the curated read getters at a
 * single time `t`, *and* the signer's role here — so everything below is sync.
 * The reads are a snapshot at `t` (the fetch time); for live values use the
 * kernel `reader` (exposed) or, later, `watch`/`priceCurve`.
 */
import { id as toId, mist, tenureCount, type Mist, type Ms } from '../primitives/brand.js';
import { createReader, type Reader } from '../read/reader.js';
import { retryingReader } from './retry.js';
import { applyPendingTransitionStates } from '../actions/apply.js';
import { rent as rentAction } from '../actions/rent.js';
import { escrowEventStream } from '../primitives/grpc-source.js';
import { subscribeEscrowVersion } from './watch.js';
import { createCap, type UsufructCap } from './cap.js';
import { sourceCoin } from './coins.js';
import type { HandleCtx } from './ctx.js';
import { createGovernanceCap, type GovernanceCap } from './governanceCap.js';
import { createInbox, type EarningsInbox, type ProtocolFeeInbox } from './inbox.js';
import { UsufructError } from './errors.js';
import { toHistoryEvent, type HistoryEvent } from './history.js';
import type { UsufructCapRecord } from './listings.js';
import { createdIdByType } from './send.js';
import { makePlan, digestPlan, type Plan } from './plan.js';
import { coinTag, price, type CoinTag, type Price } from './value.js';
import { resolveCoinInfo } from './coinmeta.js';
import { resolveWhen } from './clock.js';
import { readMarket } from './marketReadback.js';
import type { Market } from './market.js';
import { resolveRole } from './role.js';
import { fetchTypeArgs } from './typeargs.js';
import type { When } from './usufruct.js';

export type EscrowStatus = 'idle' | 'descent' | 'occupied' | 'demand' | 'retired';

/** Governor economics of a tenure expiry: the 90/10 split, coin-rendered. */
export interface TenureSettlement {
  readonly governorShare: Price;
  readonly fee: Price;
}
/** Governor economics of a handover settling at a boundary (with the refund). */
export interface HandoverSettlement {
  readonly remaining: Price;
  readonly governorShare: Price;
  readonly fee: Price;
}
/** The live resolved cycle params — the floor/ceiling/handover/descent in effect. */
export interface CyclePreview {
  readonly floor: Price;
  readonly ceilingMs: number;
  readonly handoverMs: number;
  readonly descentMs: number;
  readonly ceilingTotalMs: number | null;
  readonly handoverTotalMs: number | null;
}

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
  readonly expiresAt: Date | null;

  // identities — which objects relate to this escrow (data, any holder)
  readonly governanceCapId: string;
  readonly earningsInboxId: string;
  readonly feeInboxId: string;
  readonly activeUsufructCapId: string | null;
  /** Who holds the asset now (the active usufructuary's address). Rented only. */
  readonly activeUsufructuaryAddr: string | null;

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

  // the seats' cap handles — resolvable by ANYONE for reading (built from the ids
  // the escrow already names + its type args; no fetch, no possession). Ask the
  // returned cap about itself: `await escrow.activeCap?.state()`.
  /** The active seat's `UsufructCap` handle (for reads), or null if idle. */
  readonly activeCap: UsufructCap | null;
  /** The pending challenger's `UsufructCap` handle (for reads), or null. */
  readonly pendingCap: UsufructCap | null;

  // related objects — every one a sync handle (built from the ids the escrow
  // already names; no fetch, no possession). Ask any of them: `escrow.governanceCap
  // .governs(escrow)`, `escrow.earningsInbox.balance()`. Write methods on them still
  // require the signer to actually hold the object (else the tx aborts).
  /** The escrow's `GovernanceCap` handle. */
  readonly governanceCap: GovernanceCap;
  /** The governor's `EarningsInbox` handle. */
  readonly earningsInbox: EarningsInbox;
  /** The protocol's `ProtocolFeeInbox` handle. */
  readonly feeInbox: ProtocolFeeInbox;

  // possession — which of the above objects the signer holds (possession = role).
  readonly canRent: boolean;
  /** The signer holds the active `UsufructCap` (can borrow / write as the tenant). */
  readonly canBorrow: boolean;
  /** The signer holds this escrow's `GovernanceCap`. */
  readonly canGovern: boolean;
  /** The signer holds this escrow's `EarningsInbox`. */
  readonly holdsEarnings: boolean;

  /**
   * Acquire the right of use for `tenures`. The only decision is the **amount**:
   * `pay` (a `Price`) defaults to the floor (`floorPrice × tenures`); pay more to
   * **overpay** — the surplus becomes stake (more credit/time). The coin is the
   * escrow's own, drawn from your balance — you never name it. Returns the cap.
   *
   *   await escrow.rent({ tenures: 1 })                     // pay the floor (default signer)
   *   await escrow.rent({ tenures: 1, pay: escrow.coin(2) }) // overpay → extra stake
   *   await escrow.rent({ tenures: 1 }).send(walletExecutor) // swap how it's signed
   *   const tx = await escrow.rent({ tenures: 1 }).toTransaction(addr) // build-only
   *
   * Returns a `Plan<UsufructCap>` — a deferred write. Awaiting it (or `.send()`)
   * builds, executes with the handle's signer, and decodes the minted cap;
   * `.send(executor)` swaps signing; `.toTransaction(addr)` hands you the PTB.
   */
  rent(args: { tenures: number; pay?: Price }): Plan<UsufructCap>;

  /**
   * Preview the floor a bid would establish: what the next floor price becomes if
   * someone commits `totalBid` over `tenures`. A parameterized what-if (so a
   * method, not a snapshot getter), read live. Useful before challenging an
   * occupied escrow — the bid must clear the ascending floor.
   */
  nextFloorPrice(totalBid: Price, tenures: number): Promise<Price>;
  /** When the retire commitment unlocks (governance can then retire). Read live;
   *  ≈ now for an `immediate` commitment. */
  retireUnlocksAt(): Promise<Date>;
  /** When the ensemble (market-change) commitment unlocks. Read live; ≈ now for
   *  an `immediate` commitment. */
  ensembleUnlocksAt(): Promise<Date>;

  /**
   * The escrow's current `Market` (policy) — rest price, tenure, handover,
   * descent, curve shapes, escalation, commitments — reconstructed coin-aware from
   * its views. The read twin of `governanceCap.updateMarket`.
   */
  market(): Promise<Market>;
  /** The live resolved cycle params (active floor/ceiling/handover/descent + totals),
   *  or `null` when none apply. */
  cycle(): Promise<CyclePreview | null>;
  /** Governor economics if the current tenure settles now (90/10 split). Rented only. */
  tenureSettlement(): Promise<TenureSettlement>;
  /** Governor economics for a handover settling at `boundary` (incl. the refund). */
  handoverSettlement(boundary: When): Promise<HandoverSettlement>;
  /** When the asset was integrated (escrow genesis). */
  integratedAt(): Promise<Date>;
  /** When the current cycle phase started, or `null`. */
  phaseStartAt(): Promise<Date | null>;
  /** When the next lazy transition is due at/after `at` (default now), or `null`. */
  nextTransitionAt(at?: When): Promise<Date | null>;
  /** The wrapped asset object's id. */
  assetId(): Promise<string>;
  /** The last acquisition price (auction memory), or `null` if never rented. */
  lastRentPrice(): Promise<Price | null>;

  /**
   * Permissionless keeper: materialize the pending lazy transitions (tenure
   * expiry, auction expiry, handover) — the Move `apply_pending_transition_states`.
   * Rarely called by hand; the next interaction (e.g. a rent) applies them anyway.
   */
  applyPendingTransitionStates(): Plan<{ digest: string }>;

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

  /**
   * Live, **typed** events for this escrow — the push twin of `history()`. Each
   * `HistoryEvent` is decoded off the gRPC checkpoint firehose (no asset schema)
   * and filtered to this escrow (`opts.kinds` narrows by name, e.g. `'BidPlaced'`).
   * Returns a `stop()`. Needs a gRPC client (the SDK's default). React to *the
   * event you choose*, with its data: `escrow.onEvents(e => …, { kinds: ['BidPlaced'] })`.
   */
  onEvents(
    onEvent: (event: HistoryEvent) => void,
    opts?: { kinds?: readonly string[]; where?: (event: HistoryEvent) => boolean },
  ): () => void;
  /** Sugar: react to one event kind. `escrow.on('BidPlaced', e => counterBid(e.data))`. */
  on(kind: string, onEvent: (event: HistoryEvent) => void): () => void;
  /**
   * Resolve with the **next** typed event (one-shot, auto-unsubscribed) — the
   * event twin of `waitFor`. `await escrow.next('BidPlaced')` instead of wiring a
   * Promise around `on`. `opts.kinds` narrows by name; `opts.where` narrows by a
   * **field value** of the decoded event (e.g. `e => e.data.pending_bid_amount …`);
   * `opts.timeoutMs` bounds the wait.
   */
  nextEvent(opts?: {
    kinds?: readonly string[];
    where?: (event: HistoryEvent) => boolean;
    timeoutMs?: number;
  }): Promise<HistoryEvent>;
  /** Sugar: the next event of one kind, optionally filtered by a field value. */
  next(
    kind: string,
    opts?: { where?: (event: HistoryEvent) => boolean; timeoutMs?: number },
  ): Promise<HistoryEvent>;

  /** Escape hatch: the drift-free kernel reader for this escrow (all ~80 views). */
  readonly reader: Reader;
}

/** Build an `Escrow` handle: fetch state + read getters at `t` + role, all batched. */
export async function createEscrow(ctx: HandleCtx, idStr: string, at?: When): Promise<Escrow> {
  const { client, packageId, account, defaultExecutor, assetSchema, retry } = ctx;
  const owner = account; // identity for role resolution + the build-time sender
  const escrowId = toId<'Escrow'>(idStr);

  // Type args come from the object's type string — no decode, no asset schema.
  const [[assetType, coinType], t] = await Promise.all([fetchTypeArgs(client, escrowId), resolveWhen(client, at)]);

  const kernelReader = createReader(client, {
    packageId,
    escrowId,
    typeArguments: [assetType, coinType],
    ...(assetSchema ? { assetSchema } : {}),
  });
  // Retry the truncated-`simulateTransaction` shape the client proxy can't see
  // (it throws inside the reader's own parse). Status is handled by the client.
  const reader = retry ? retryingReader(kernelReader, retry) : kernelReader;

  // One batched simulation for the unconditional snapshot (+ status booleans) —
  // every view evaluated against a single chain state, coherent at `t`.
  const b1 = await reader.batch(
    [
      'floorPriceMist', 'isRetired', 'isOccupied', 'isDemand', 'isDescending',
      'tenureExpiryMs', 'activeUsufructCapId', 'governanceCapId', 'earningsInboxId', 'feeInboxId',
    ],
    { t },
  );
  const v = <T>(k: string): T => b1[k] as T;
  const floorMist = v<Mist>('floorPriceMist');
  const expiryMs = v<Ms | null>('tenureExpiryMs');
  const activeCapId = v<string | null>('activeUsufructCapId');
  const govCapId = v<string>('governanceCapId');
  const inboxId = v<string>('earningsInboxId');
  const feeInboxId = v<string>('feeInboxId');
  const status: EscrowStatus = v<boolean>('isRetired')
    ? 'retired'
    : v<boolean>('isOccupied')
      ? 'occupied'
      : v<boolean>('isDemand')
        ? 'demand'
        : v<boolean>('isDescending')
          ? 'descent'
          : 'idle';

  // Conditional views — pending challenger + handover only exist in `demand`, the
  // active usufructuary addr only when rented. Batch exactly the views valid now
  // (an aborting view would fail the whole sim). Seat economics belong to the
  // cap's `state()`, object-centric, not here.
  const rented = status === 'occupied' || status === 'demand';
  const challenged = status === 'demand';
  const condNames = [
    ...(rented ? ['activeUsufructuaryAddr'] : []),
    ...(challenged ? ['pendingUsufructCapId', 'pendingUsufructuaryAddr', 'handoverExpiryMs'] : []),
  ];
  const [role, b2] = await Promise.all([
    resolveRole(client, packageId, owner, activeCapId, govCapId, inboxId),
    condNames.length ? reader.batch(condNames, { t }) : Promise.resolve({} as Record<string, unknown>),
  ]);
  const activeAddr = rented ? ((b2['activeUsufructuaryAddr'] as string | null) ?? null) : null;
  const pendingCapId = challenged ? ((b2['pendingUsufructCapId'] as string | null) ?? null) : null;
  const pendingAddr = challenged ? ((b2['pendingUsufructuaryAddr'] as string | null) ?? null) : null;
  const handoverMs = challenged ? ((b2['handoverExpiryMs'] as Ms | null) ?? null) : null;

  // Real decimals/symbol from CoinMetadata (cached) — assuming 9 renders any
  // non-SUI coin wrong (e.g. 6-decimal USDC). Keeps the handle coin-agnostic.
  const coin = await resolveCoinInfo(client, coinType);
  const typeArguments: [string, string] = [assetType, coinType];
  const applyPending = (): Plan<{ digest: string }> =>
    digestPlan(
      () => defaultExecutor,
      (tx) =>
        applyPendingTransitionStates().toPtb(tx, { pkg: { packageId }, escrowId, typeArguments }),
    );

  // Live reader wrappers (zero cost unless called), typed in the escrow's coin / as Dates.
  async function nextFloorPrice(totalBid: Price, tenures: number): Promise<Price> {
    const next = await reader.nextFloorPriceMist(mist(totalBid.mist), tenureCount(BigInt(tenures)));
    return price(next, coin);
  }
  const retireUnlocksAt = async (): Promise<Date> =>
    new Date(Number(await reader.retireCommitmentUnlocksAtMs()));
  const ensembleUnlocksAt = async (): Promise<Date> =>
    new Date(Number(await reader.ensembleCommitmentUnlocksAtMs()));

  const market = (): Promise<Market> => readMarket(reader, coinTag(coin));

  async function cycle(): Promise<CyclePreview | null> {
    const [cp, ceilTotal, hoTotal] = await Promise.all([
      reader.activeCycleParams(),
      reader.activeCeilingTotalMs(),
      reader.activeHandoverTotalMs(),
    ]);
    if (cp == null) return null;
    return {
      floor: price(cp.floorMist, coin),
      ceilingMs: Number(cp.ceilingMs),
      handoverMs: Number(cp.handoverMs),
      descentMs: Number(cp.descentMs),
      ceilingTotalMs: ceilTotal == null ? null : Number(ceilTotal),
      handoverTotalMs: hoTotal == null ? null : Number(hoTotal),
    };
  }

  async function tenureSettlement(): Promise<TenureSettlement> {
    const s = await reader.tenureSettlement();
    return { governorShare: price(s.governorShareMist, coin), fee: price(s.feeMist, coin) };
  }
  async function handoverSettlement(boundary: When): Promise<HandoverSettlement> {
    const s = await reader.handoverSettlement(await resolveWhen(client, boundary));
    return {
      remaining: price(s.remainingMist, coin),
      governorShare: price(s.governorShareMist, coin),
      fee: price(s.feeMist, coin),
    };
  }

  const integratedAt = async (): Promise<Date> => new Date(Number(await reader.integratedAtMs()));
  const phaseStartAt = async (): Promise<Date | null> => {
    const m = await reader.phaseStartMs();
    return m == null ? null : new Date(Number(m));
  };
  async function nextTransitionAt(at?: When): Promise<Date | null> {
    const m = await reader.nextTransitionMs(await resolveWhen(client, at));
    return m == null ? null : new Date(Number(m));
  }
  const assetId = (): Promise<string> => reader.assetId();
  async function lastRentPrice(): Promise<Price | null> {
    const m = await reader.lastRentPriceMist();
    return m == null ? null : price(m, coin);
  }

  // Every related object as a sync handle — built from the ids the escrow already
  // names + its type args (no fetch, no possession). Read or act on any of them;
  // write methods still require the signer to actually hold the object. Possession
  // is the boolean axis below (canBorrow / canGovern / holdsEarnings).
  const capHandle = (capId: string | null): UsufructCap | null =>
    capId == null ? null : createCap(ctx, { capId, escrowId: idStr, typeArguments, receipt: null });
  const activeCap = capHandle(activeCapId);
  const pendingCap = capHandle(pendingCapId);
  const governanceCap: GovernanceCap = createGovernanceCap(ctx, govCapId);
  const earningsInbox: EarningsInbox = createInbox(ctx, inboxId, 'earnings');
  const feeInbox: ProtocolFeeInbox = createInbox(ctx, feeInboxId, 'fees');

  function rent(args: { tenures: number; pay?: Price }): Plan<UsufructCap> {
    const count = BigInt(args.tenures);
    // The decision: pay the floor (default) or overpay (surplus → stake). The
    // coin is the escrow's own — auto-sourced; the renter only chooses the number.
    const paidMist = args.pay ? args.pay.mist : floorMist * count; // floor snapshot @ fetch `t`

    return makePlan<UsufructCap>({
      // default execution = the handle's configured executor; null ⇒ read-only.
      defaultExecutor: () => defaultExecutor,

      // phase 1 — build: source the payment from `sender`, mint, keep the cap.
      build: async (tx, sender) => {
        const payment = await sourceCoin(tx, client, sender, { coinType, amountMist: paidMist });
        const minted = rentAction({ tenures: tenureCount(count) }).toPtb(tx, {
          pkg: { packageId },
          escrowId,
          payment,
          typeArguments,
        });
        tx.transferObjects([minted], sender);
      },

      // phase 3 — decode: created cap id (from effects) + a post-exec read for expiry.
      decode: async (res) => {
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

  // Re-resolve the decode-free handle on each version change (the shared subscribe
  // loop lives in `watch.ts` and is reused by `usufructCap.watch`).
  function watch(onChange: (e: Escrow) => void, watchOpts?: { intervalMs?: number }): () => void {
    return subscribeEscrowVersion(
      ctx,
      escrowId,
      async (alive) => {
        const snap = await createEscrow(ctx, idStr);
        if (alive()) onChange(snap);
      },
      watchOpts,
    );
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

  function onEvents(
    onEvent: (event: HistoryEvent) => void,
    onOpts?: { kinds?: readonly string[]; where?: (event: HistoryEvent) => boolean },
  ): () => void {
    const grpc = ctx.grpcClient;
    if (grpc == null) {
      throw new UsufructError('onEvents requires a gRPC client (live event push) — the SDK default');
    }
    const controller = new AbortController();
    void (async () => {
      try {
        const stream = escrowEventStream(grpc, escrowId, packageId, {
          signal: controller.signal,
          ...(onOpts?.kinds ? { kinds: onOpts.kinds } : {}),
        });
        for await (const ev of stream) {
          if (controller.signal.aborted) break;
          const he = toHistoryEvent(ev);
          if (onOpts?.where && !onOpts.where(he)) continue; // filter by a field value
          try {
            onEvent(he);
          } catch {
            /* a consumer error must not kill the stream */
          }
        }
      } catch {
        /* aborted or stream error */
      }
    })();
    return () => controller.abort();
  }

  function on(kind: string, onEvent: (event: HistoryEvent) => void): () => void {
    return onEvents(onEvent, { kinds: [kind] });
  }

  function nextEvent(nextOpts?: {
    kinds?: readonly string[];
    where?: (event: HistoryEvent) => boolean;
    timeoutMs?: number;
  }): Promise<HistoryEvent> {
    return new Promise<HistoryEvent>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const stop = onEvents(
        (ev) => {
          stop();
          if (timer) clearTimeout(timer);
          resolve(ev);
        },
        {
          ...(nextOpts?.kinds ? { kinds: nextOpts.kinds } : {}),
          ...(nextOpts?.where ? { where: nextOpts.where } : {}),
        },
      );
      if (nextOpts?.timeoutMs !== undefined) {
        timer = setTimeout(() => {
          stop();
          reject(new Error(`next event timed out after ${nextOpts.timeoutMs}ms`));
        }, nextOpts.timeoutMs);
      }
    });
  }

  function next(
    kind: string,
    nextOpts?: { where?: (event: HistoryEvent) => boolean; timeoutMs?: number },
  ): Promise<HistoryEvent> {
    return nextEvent({
      kinds: [kind],
      ...(nextOpts?.where ? { where: nextOpts.where } : {}),
      ...(nextOpts?.timeoutMs !== undefined ? { timeoutMs: nextOpts.timeoutMs } : {}),
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
    expiresAt: expiryMs == null ? null : new Date(Number(expiryMs)),
    governanceCapId: govCapId,
    earningsInboxId: inboxId,
    feeInboxId,
    activeUsufructCapId: activeCapId,
    activeUsufructuaryAddr: activeAddr,
    isChallenged: challenged,
    pendingUsufructCapId: pendingCapId,
    pendingUsufructuaryAddr: pendingAddr,
    handoverExpiresAt: handoverMs == null ? null : new Date(Number(handoverMs)),
    activeCap,
    pendingCap,
    governanceCap,
    earningsInbox,
    feeInbox,
    canRent: owner != null && status !== 'retired',
    canBorrow: role.capId != null,
    canGovern: role.governs,
    holdsEarnings: role.holdsEarnings,
    rent,
    nextFloorPrice,
    retireUnlocksAt,
    ensembleUnlocksAt,
    market,
    cycle,
    tenureSettlement,
    handoverSettlement,
    integratedAt,
    phaseStartAt,
    nextTransitionAt,
    assetId,
    lastRentPrice,
    applyPendingTransitionStates: applyPending,
    usufructCaps,
    history,
    watch,
    waitFor,
    onEvents,
    on,
    nextEvent,
    next,
    reader,
  };
}
