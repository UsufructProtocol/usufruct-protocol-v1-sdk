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
import { createReader } from '../read/reader.js';
import { escrowTypeArgs } from '../primitives/state.js';
import { retryingReader } from './retry.js';
import { applyToPtb } from '../actions/apply.js';
import { rentToPtb as rentAction } from '../actions/rent.js';
import { escrowEventStream } from '../primitives/grpc-source.js';
import { subscribeEscrowVersion } from './watch.js';
import { createCap, type UsufructCap } from './cap.js';
import { sourceCoin } from './coins.js';
import type { HandleCtx } from './ctx.js';
import { createGovernanceCap, type GovernanceCap } from './governanceCap.js';
import { createInbox, type EarningsInbox, type ProtocolFeeInbox } from './inbox.js';
import { UsufructError } from './errors.js';
import { toHistoryEvent, type HistoryEvent } from './history.js';
import {
  reconstructCreditHistory,
  reconstructPriceTimeline,
  type CreditSegment,
  type CurveOpts,
  type DescentSegment,
  type LadderRung,
  type TimelineSegment,
} from './timeline.js';
import { sampleCreditCurve, sampleDescentCurve, sampleEscalationLadder, type Escalation } from '../read/curve.js';
import { createScalarReadVerb, type ScalarReadVerb } from './escrowRead.js';
import { reconstructTenancies, type Tenancy } from './ledger.js';
import type { UsufructCapRecord } from './listings.js';
import { createdIdByType } from './send.js';
import { makePlan, digestPlan, type Plan } from './plan.js';
import { coinTag, price, type CoinTag, type CoinInfo, type Price } from './value.js';
import { resolveCoinInfo } from './coinmeta.js';
import { resolveWhen } from './clock.js';
import { readMarket } from './marketReadback.js';
import type { Market } from './market.js';
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

// ════════════════════════════════════════════════════════════════════════════
// The four-verb surface (additive — coexists with the flat members below until
// the Phase-E cut). identity (flat) + nav (edges) + read · inspect · react · write.
// ════════════════════════════════════════════════════════════════════════════

/** The asset's lifecycle state — the protocol `AssetState` as a discriminated union
 *  that carries each phase's data (status + occupant + expiry + challenger + handover). */
export type AssetState =
  | { readonly kind: 'idle'; readonly floor: Price }
  | { readonly kind: 'occupied'; readonly cap: string; readonly usufructuary: string; readonly stake: Price; readonly expiresAt: Date }
  | {
      readonly kind: 'demand';
      readonly cap: string;
      readonly usufructuary: string;
      readonly challengerCap: string;
      readonly challenger: string;
      readonly bid: Price;
      readonly handoverExpiresAt: Date;
    }
  | { readonly kind: 'descent'; readonly from: Price; readonly floor: Price; readonly expiresAt: Date }
  | { readonly kind: 'retired' };

/** A coherent cross-section at one `t` — the asset state with the time it was read. */
export interface EscrowSnapshot {
  readonly at: Date;
  readonly state: AssetState;
}

/** nav — the edges out of this node (returns related handles, not state). */
export interface EscrowNavVerb {
  activeCap(): Promise<UsufructCap | null>;
  pendingCap(): Promise<UsufructCap | null>;
  governanceCap(): Promise<GovernanceCap>;
  earningsInbox(): Promise<EarningsInbox>;
  feeInbox(): Promise<ProtocolFeeInbox>;
}

/** read — the protocol's views, on-chain, live: the auto-rendered scalar surface
 *  ({@link ScalarReadVerb}) + the heterogeneous composites. */
export type EscrowReadVerb = ScalarReadVerb & {
  /** The asset's lifecycle state now (discriminated; narrows to the phase's data). */
  assetState(at?: When): Promise<AssetState>;
  /** The asset state with the `t` it was read at (a coherent, timestamped photo). */
  snapshot(at?: When): Promise<EscrowSnapshot>;
  /** The escrow's payment coin tag (immutable; cached). */
  coin(): Promise<CoinTag>;
  market(): Promise<Market>;
  cycle(): Promise<CyclePreview | null>;
  tenureSettlement(): Promise<TenureSettlement>;
  handoverSettlement(boundary: When): Promise<HandoverSettlement>;
  nextFloorPrice(totalBid: Price, tenures: number): Promise<Price>;
  escalationLadder(opts?: { steps?: number; tenures?: number; from?: Price }): Promise<LadderRung[]>;
  /** The CURRENT cycle's curve, sampled LIVE from the views (no event log) — the
   *  historical multi-segment versions are `inspect.creditHistory`/`priceTimeline`. */
  creditCurve(opts?: CurveOpts): Promise<CreditSegment | null>;
  descentCurve(opts?: CurveOpts): Promise<DescentSegment | null>;
};

/** inspect — the event log (pull): history + the event-sourced reconstructions. */
export interface EscrowInspectVerb {
  history(opts?: { sender?: string; afterCheckpoint?: number; beforeCheckpoint?: number }): Promise<HistoryEvent[]>;
  priceTimeline(opts?: CurveOpts): Promise<TimelineSegment[]>;
  creditHistory(opts?: CurveOpts): Promise<CreditSegment[]>;
  tenancies(opts?: { sender?: string; afterCheckpoint?: number; beforeCheckpoint?: number }): Promise<Tenancy[]>;
  usufructCaps(): Promise<UsufructCapRecord[]>;
}

/** react — the event log (push): the gRPC firehose + version watch. */
export interface EscrowReactVerb {
  watch(onChange: (escrow: Escrow) => void, opts?: { intervalMs?: number }): () => void;
  waitFor(predicate: (escrow: Escrow) => boolean | Promise<boolean>, opts?: { intervalMs?: number; timeoutMs?: number }): Promise<Escrow>;
  onEvents(onEvent: (event: HistoryEvent) => void, opts?: { kinds?: readonly string[]; where?: (event: HistoryEvent) => boolean }): () => void;
  on(kind: string, onEvent: (event: HistoryEvent) => void): () => void;
  nextEvent(opts?: { kinds?: readonly string[]; where?: (event: HistoryEvent) => boolean; timeoutMs?: number }): Promise<HistoryEvent>;
  next(kind: string, opts?: { where?: (event: HistoryEvent) => boolean; timeoutMs?: number }): Promise<HistoryEvent>;
}

/** write — the protocol's write functions (PTB / Plan). */
export interface EscrowWriteVerb {
  /**
   * Acquire the right of use. `to` directs the minted `UsufructCap` (default: the
   * sender), atomically in the same transaction — e.g. rent on behalf of a buyer.
   */
  rent(args: { tenures: number; pay?: Price; to?: string }): Plan<UsufructCap>;
  applyPendingTransitionStates(): Plan<{ digest: string }>;
}

/** The hub handle. Reads are sync getters off one fetch; writes return handles. */
export interface Escrow {
  // identity — the object's name (zero state; everything else is read live via the verbs)
  readonly id: string;
  readonly assetType: string;
  readonly coinType: string;
  /** The escrow's payment coin as a tag (resolved decimals/symbol) — to express
   *  amounts in it, e.g. `pay: escrow.coin(0.6)`. The coin is fixed at integrate. */
  readonly coin: CoinTag;

  // nav (edges) + the four verbs (operations on this node; all live, all async)
  readonly nav: EscrowNavVerb;
  readonly read: EscrowReadVerb;
  readonly inspect: EscrowInspectVerb;
  readonly react: EscrowReactVerb;
  readonly write: EscrowWriteVerb;
}

/** The identity inputs `createEscrowMany` pre-resolves for the whole set so each
 *  lazy handle skips its own type-args + coin-metadata fetch. */
export interface ResolvedEscrow {
  readonly typeArguments: [string, string];
  readonly coin: CoinInfo;
}

/** Build an `Escrow` handle: fetch state + read getters at `t` + role, all batched.
 *  `pre` (from `createEscrowMany`) supplies the resolved reads to skip all per-escrow IO. */
export async function createEscrow(
  ctx: HandleCtx,
  idStr: string,
  at?: When,
  pre?: ResolvedEscrow,
): Promise<Escrow> {
  const { client, packageId, defaultExecutor, retry } = ctx;
  const escrowId = toId<'Escrow'>(idStr);

  // Construction fetches only what IDENTITY needs: the type args (from the object's
  // type string, no decode) and the coin metadata (for rendering). There is NO
  // fetch-time state snapshot — the verbs read the deployed views live on demand,
  // so nothing the handle exposes can go stale. (`at` is a per-read concern now.)
  const [assetType, coinType] = pre?.typeArguments ?? (await fetchTypeArgs(client, escrowId));
  const typeArguments: [string, string] = [assetType, coinType];

  const kernelReader = createReader(client, { packageId, escrowId, typeArguments });
  // Retry the truncated-`simulateTransaction` shape the client proxy can't see
  // (it throws inside the reader's own parse). Status is handled by the client.
  const reader = retry ? retryingReader(kernelReader, retry) : kernelReader;

  // Real decimals/symbol from CoinMetadata (cached) — assuming 9 renders any
  // non-SUI coin wrong (e.g. 6-decimal USDC). Keeps the handle coin-agnostic.
  const coin = pre?.coin ?? (await resolveCoinInfo(client, coinType));
  const applyPending = (): Plan<{ digest: string }> =>
    digestPlan(
      () => defaultExecutor,
      (tx) =>
        applyToPtb()(tx, { pkg: { packageId }, escrowId, typeArguments }),
    );

  // Live reader wrappers (zero cost unless called), typed in the escrow's coin / as Dates.
  async function nextFloorPrice(totalBid: Price, tenures: number): Promise<Price> {
    const next = await reader.nextFloorPriceMist(mist(totalBid.mist), tenureCount(BigInt(tenures)));
    return price(next, coin);
  }
  const market = (): Promise<Market> => readMarket(reader, coinTag(coin));

  async function cycle(): Promise<CyclePreview | null> {
    const [cp, ceilTotal, hoTotal] = await Promise.all([
      reader.cycleParams(),
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

  // A cap handle from an id (built from the escrow's type args; no fetch, no
  // possession). `nav.activeCap`/`pendingCap` read the live id and pass it here.
  const capHandle = (capId: string | null): UsufructCap | null =>
    capId == null ? null : createCap(ctx, { capId, escrowId: idStr, typeArguments, receipt: null });

  function rent(args: { tenures: number; pay?: Price; to?: string }): Plan<UsufructCap> {
    const count = BigInt(args.tenures);
    // The decision: pay the floor (default) or overpay (surplus → stake). The
    // coin is the escrow's own — auto-sourced; the renter only chooses the number.
    let paidMist = args.pay ? args.pay.mist : 0n; // the floor is read live in build

    return makePlan<UsufructCap>({
      // default execution = the handle's configured executor; null ⇒ read-only.
      defaultExecutor: () => defaultExecutor,

      // phase 1 — build: source the payment from `sender`, mint, send the cap to
      // `to` (default the sender) — atomically, in this same PTB.
      build: async (tx, sender) => {
        if (!args.pay) paidMist = (await reader.floorPriceMist(await resolveWhen(client, 'now'))) * count;
        const payment = await sourceCoin(tx, client, sender, { coinType, amountMist: paidMist });
        const minted = rentAction({ tenures: tenureCount(count) })(tx, {
          pkg: { packageId },
          escrowId,
          payment,
          typeArguments,
        });
        tx.transferObjects([minted], args.to ?? sender);
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

  async function creditHistory(curveOpts?: CurveOpts): Promise<CreditSegment[]> {
    return reconstructCreditHistory(await history(), client, packageId, coin, curveOpts);
  }
  async function priceTimeline(curveOpts?: CurveOpts): Promise<TimelineSegment[]> {
    return reconstructPriceTimeline(await history(), client, packageId, coin, curveOpts);
  }
  async function tenancies(histOpts?: { sender?: string; afterCheckpoint?: number; beforeCheckpoint?: number }): Promise<Tenancy[]> {
    return reconstructTenancies(await history(histOpts), coin);
  }
  async function escalationLadder(ladderOpts?: {
    steps?: number;
    tenures?: number;
    from?: Price;
  }): Promise<LadderRung[]> {
    const steps = ladderOpts?.steps ?? 8;
    const tenures = BigInt(ladderOpts?.tenures ?? 1);
    const e = await reader.priceEscalation();
    const escalation: Escalation =
      e.kind === 'fixedDelta'
        ? { kind: 'fixedDelta', deltaMist: e.deltaMist }
        : { kind: 'compoundDelta', bps: e.bps, deltaMist: e.deltaMist };
    const startMist = ladderOpts?.from?.mist ?? (await reader.floorPriceMist(await resolveWhen(client, 'now')));
    const rungs = await sampleEscalationLadder(client, packageId, { startMist, tenures, escalation, steps });
    return [
      { step: 0, price: price(startMist, coin) },
      ...rungs.map((m, i) => ({ step: i + 1, price: price(m, coin) })),
    ];
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
    predicate: (e: Escrow) => boolean | Promise<boolean>,
    waitOpts?: { intervalMs?: number; timeoutMs?: number },
  ): Promise<Escrow> {
    return new Promise<Escrow>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const stop = watch(
        (e) => {
          void Promise.resolve(predicate(e)).then((ok) => {
            if (ok) {
              stop();
              if (timer) clearTimeout(timer);
              resolve(e);
            }
          });
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

  // ── verb composites (all LIVE — read the deployed views, never the fetch-time
  //    snapshot, so they never go stale). ──
  const spanTimes = (start: bigint, span: bigint, points: number): bigint[] => {
    const out: bigint[] = [];
    for (let i = 0; i <= points; i++) out.push(start + (span * BigInt(i)) / BigInt(points));
    return out;
  };
  const curvePoints = (start: bigint, ts: readonly bigint[], vals: readonly bigint[]) =>
    ts.map((tp, i) => ({ atMs: Number(tp), offsetMs: Number(tp - start), value: price(vals[i]!, coin) }));

  async function assetState(at?: When): Promise<AssetState> {
    const tt = await resolveWhen(client, at);
    const b = await reader.batch(['isRetired', 'isOccupied', 'isDemand', 'isDescending', 'floorPriceMist'], { t: tt });
    const st: EscrowStatus = b['isRetired']
      ? 'retired'
      : b['isOccupied']
        ? 'occupied'
        : b['isDemand']
          ? 'demand'
          : b['isDescending']
            ? 'descent'
            : 'idle';
    if (st === 'retired') return { kind: 'retired' };
    const floor = price(b['floorPriceMist'] as Mist, coin);
    if (st === 'idle') return { kind: 'idle', floor };
    if (st === 'descent') {
      const [fromM, expM] = await Promise.all([reader.lastRentPriceMist(), reader.descentExpiryMs()]);
      return { kind: 'descent', from: price(fromM ?? mist(0n), coin), floor, expiresAt: new Date(Number(expM ?? 0n)) };
    }
    const seat = await reader.batch(
      ['activeUsufructCapId', 'activeUsufructuaryAddr', 'activeStakeBalanceMist', 'tenureExpiryMs'],
      { t: tt },
    );
    const seatCap = (seat['activeUsufructCapId'] as string | null) ?? '';
    const seatAddr = (seat['activeUsufructuaryAddr'] as string | null) ?? '';
    const seatStake = price((seat['activeStakeBalanceMist'] as Mist | null) ?? mist(0n), coin);
    if (st === 'occupied') {
      return {
        kind: 'occupied',
        cap: seatCap,
        usufructuary: seatAddr,
        stake: seatStake,
        expiresAt: new Date(Number((seat['tenureExpiryMs'] as Ms | null) ?? 0n)),
      };
    }
    const dem = await reader.batch(
      ['pendingUsufructCapId', 'pendingUsufructuaryAddr', 'pendingStakeBalanceMist', 'handoverExpiryMs'],
      { t: tt },
    );
    return {
      kind: 'demand',
      cap: seatCap,
      usufructuary: seatAddr,
      challengerCap: (dem['pendingUsufructCapId'] as string | null) ?? '',
      challenger: (dem['pendingUsufructuaryAddr'] as string | null) ?? '',
      bid: price((dem['pendingStakeBalanceMist'] as Mist | null) ?? mist(0n), coin),
      handoverExpiresAt: new Date(Number((dem['handoverExpiryMs'] as Ms | null) ?? 0n)),
    };
  }

  async function snapshotRead(at?: When): Promise<EscrowSnapshot> {
    const tt = await resolveWhen(client, at);
    const state = await assetState(new Date(Number(tt)));
    return { at: new Date(Number(tt)), state };
  }

  async function liveCreditCurve(curveOpts?: CurveOpts): Promise<CreditSegment | null> {
    const pts = curveOpts?.points ?? 24;
    const [occ, stakeM, phaseM, ceilM, shape, capId] = await Promise.all([
      reader.isOccupied(),
      reader.activeStakeBalanceMist(),
      reader.phaseStartMs(),
      reader.activeCeilingTotalMs(),
      reader.creditShape(),
      reader.activeUsufructCapId(),
    ]);
    if (!occ || stakeM == null || phaseM == null || ceilM == null) return null;
    const ts = spanTimes(phaseM, ceilM, pts);
    const vals = await sampleCreditCurve(client, packageId, { stakeMist: stakeM, phaseStartMs: phaseM, ceilingMs: ceilM, shape }, ts);
    return {
      capId: capId ?? null,
      principal: price(stakeM, coin),
      shape,
      startedAt: new Date(Number(phaseM)),
      ceilingMs: Number(ceilM),
      points: curvePoints(phaseM, ts, vals),
    };
  }

  async function liveDescentCurve(curveOpts?: CurveOpts): Promise<DescentSegment | null> {
    const pts = curveOpts?.points ?? 24;
    // The descent's resolved cycle (floor / descent duration) comes from the one
    // cross-state `cycleParams` view — it resolves the active ensemble in every
    // non-retired state, so there is no Renting-vs-Waiting projection to pick.
    const [desc, lastM, phaseM, cyc, shape] = await Promise.all([
      reader.isDescending(),
      reader.lastRentPriceMist(),
      reader.phaseStartMs(),
      reader.cycleParams(),
      reader.auctionShape(),
    ]);
    if (!desc || lastM == null || phaseM == null || cyc == null) return null;
    const descentMs = cyc.descentMs;
    if (descentMs == null || descentMs === 0n) return null;
    const ts = spanTimes(phaseM, descentMs, pts);
    const vals = await sampleDescentCurve(
      client,
      packageId,
      { lastAcqMist: lastM, phaseStartMs: phaseM, floorMist: cyc.floorMist, descentMs, shape },
      ts,
    );
    return {
      shape,
      startedAt: new Date(Number(phaseM)),
      descentMs: Number(descentMs),
      from: price(lastM, coin),
      to: price(cyc.floorMist, coin),
      points: curvePoints(phaseM, ts, vals),
    };
  }

  // ── assemble the verb sub-objects (wire the closures above into the four verbs).
  //    nav reads each edge's id live (the counterpart ids are immutable, but reading
  //    them on demand keeps construction snapshot-free). ──
  const nav: EscrowNavVerb = {
    activeCap: async () => capHandle(await reader.activeUsufructCapId()),
    pendingCap: async () => capHandle(await reader.pendingUsufructCapId()),
    governanceCap: async () => createGovernanceCap(ctx, await reader.governanceCapId()),
    earningsInbox: async () => createInbox(ctx, await reader.earningsInboxId(), 'earnings'),
    feeInbox: async () => createInbox(ctx, await reader.feeInboxId(), 'fees'),
  };
  const read: EscrowReadVerb = {
    ...createScalarReadVerb(reader, coin, client),
    assetState,
    snapshot: snapshotRead,
    coin: () => Promise.resolve(coinTag(coin)),
    market,
    cycle,
    tenureSettlement,
    handoverSettlement,
    nextFloorPrice,
    escalationLadder,
    creditCurve: liveCreditCurve,
    descentCurve: liveDescentCurve,
  };
  const inspect: EscrowInspectVerb = { history, priceTimeline, creditHistory, tenancies, usufructCaps };
  const react: EscrowReactVerb = { watch, waitFor, onEvents, on, nextEvent, next };
  const write: EscrowWriteVerb = { rent, applyPendingTransitionStates: applyPending };

  return {
    // identity — the object's name (zero state; everything else reads live via verbs)
    id: idStr,
    assetType,
    coinType,
    coin: coinTag(coin),
    // nav (edges) + the four verbs
    nav,
    read,
    inspect,
    react,
    write,
  };
}

/**
 * Resolve MANY escrow handles, sharing the only per-set IO there is now that handles
 * are lazy: one `getObjects` for all type args + coin metadata fetched once per
 * distinct coin. Each handle then reads its own state live via the verbs on demand —
 * there is no fetch-time snapshot to pre-batch.
 */
export async function createEscrowMany(ctx: HandleCtx, idStrs: string[], at?: When): Promise<Escrow[]> {
  if (idStrs.length === 0) return [];
  const { client } = ctx;

  const objsRes = await client.core.getObjects({ objectIds: idStrs });
  const typeArgs: [string, string][] = objsRes.objects.map((o) => {
    if (o instanceof Error) throw o;
    return escrowTypeArgs(o.type);
  });

  // Coin metadata — once per distinct coin type.
  const coinByType = new Map<string, CoinInfo>();
  await Promise.all(
    [...new Set(typeArgs.map(([, c]) => c))].map(async (c) =>
      coinByType.set(c, await resolveCoinInfo(client, c)),
    ),
  );

  return Promise.all(
    idStrs.map((idStr, i) =>
      createEscrow(ctx, idStr, at, {
        typeArguments: typeArgs[i]!,
        coin: coinByType.get(typeArgs[i]![1])!,
      }),
    ),
  );
}
