/**
 * The `UsufructCap` handle (Layer 2) — the right of use, and the keystone
 * `borrow`/`return` bracket.
 *
 * The cap is the *receiver* of its writes (never a hidden argument). `borrow`
 * runs the caller's PTB middle between an appended `borrow` and a **guaranteed**
 * `return` — the protocol's reason to exist, made effortless without taking the
 * middle away.
 */
import { Transaction, type TransactionObjectArgument } from '@mysten/sui/transactions';
import { digestPlan, makePlan, type Plan } from './plan.js';
import { withBorrowedAsset } from '../actions/borrow.js';
import {
  burnStaleUsufructCapToPtb,
  burnUsufructCapToPtb,
  updateUsufructuaryRefundAddressToPtb,
} from '../actions/governance.js';
import { id as toId, type Mist } from '../primitives/brand.js';
import { createReader, type Reader } from '../read/reader.js';
import { transferOf } from './bearer.js';
import { resolveCoinInfo } from './coinmeta.js';
import { resolveWhen } from './clock.js';
import { reconstructStatement, type RenterStatement } from './ledger.js';
import { retryingReader } from './retry.js';
import { subscribeEscrowVersion } from './watch.js';
import type { HandleCtx } from './ctx.js';
import { createEscrow, type Escrow } from './escrow.js';
import { UsufructError } from './errors.js';
import { toHistoryEvent, type HistoryEvent } from './history.js';
import { normEscrowId } from '../indexer/events.js';
import { price, type Price } from './value.js';
import type { When } from './usufruct.js';

/** Mint details when the cap came from a `rent()` call. */
export interface RentReceipt {
  /** What was paid (≥ floor × tenures; surplus becomes stake). */
  readonly paid: Price;
  /** When the current tenancy boundary falls. */
  readonly expiresAt: Date;
  /** The rent transaction digest. */
  readonly digest: string;
}

/**
 * The caller's PTB middle — one zone where the code foreign to the SDK lives.
 * The asset and the whole `tx` are handed in; the `return` is appended for you.
 * A `Use` is just a value: write it inline as a lambda, as a named constant in
 * another file, or as a factory `(args) => Use` when it needs parameters.
 */
export type Use = (asset: TransactionObjectArgument, tx: Transaction) => void;

/** Compose several `Use` middles into one, applied left-to-right over the same `(asset, tx)`. */
const compose =
  (uses: Use[]): Use =>
  (asset, tx) => {
    for (const use of uses) use(asset, tx);
  };

/** Outcome of a borrow once executed (the asset was returned in the same PTB). */
export interface BorrowReceipt {
  readonly digest: string;
  readonly returned: true;
}

/**
 * borrow → your calls → return, as a `Plan`. Pass one `Use`, or several — they
 * compose in order inside the single bracket. `.send()` signs & sends;
 * `.build(tx, sender)` drops the bracket into a PTB you drive (sponsorship /
 * batching / multiple brackets); `.toTransaction()` hands you the PTB.
 */
export type BorrowMethod = (...uses: Use[]) => Plan<BorrowReceipt>;

/** This cap's relationship to its escrow's seats, by possession of the seat. */
export type UsufructCapRole = 'active' | 'pending' | 'stale' | 'unknown';

/**
 * The cap's read photo — its seat, object-centric. The seat numbers
 * (`stake`/`timeRemainingMs`/…) are the *active* (or *pending*) seat's values, so
 * they are populated only when THIS cap holds that seat; otherwise `null`. (Asking
 * a displaced cap for "its" stake honestly returns `null`, not another seat's.)
 */
export interface UsufructCapState {
  readonly role: UsufructCapRole;
  /** The seat's usufructuary address (active or pending), else `null`. */
  readonly usufructuaryAddr: string | null;
  /** Staked balance — the seat's prepaid credit pool. Active or pending seat. */
  readonly stake: Price | null;
  /** Stake left after credit consumed, at `t`. Active seat only. */
  readonly stakeRemaining: Price | null;
  /** Credit consumed so far, at `t`. Active seat only. */
  readonly accruedCredit: Price | null;
  /** Tenures this seat committed to. Active or pending seat. */
  readonly committedTenures: number | null;
  /** Ms this seat has left at `t`. Active seat only. */
  readonly timeRemainingMs: number | null;
  /** Whether this seat's credit is currently accruing. Active seat only. */
  readonly creditAccruing: boolean | null;
  /** When credit accrual caps (stake fully consumed), or null. Active seat only. */
  readonly creditCappedAt: Date | null;
}

// ── the four-verb surface (additive; coexists with the flat members until Phase E) ──
/** nav — the edges out of this cap. */
export interface CapNavVerb {
  /** Back-edge: the escrow this cap belongs to (its `escrow_identity`). */
  escrow(): Promise<Escrow>;
}
/** read — this cap's seat, live. */
export interface CapReadVerb {
  state(opts?: { at?: When }): Promise<UsufructCapState>;
  isActive(): Promise<boolean>;
  isPending(): Promise<boolean>;
  isStale(): Promise<boolean>;
}
/** inspect — the event log (pull). */
export interface CapInspectVerb {
  history(opts?: { sender?: string; afterCheckpoint?: number; beforeCheckpoint?: number }): Promise<HistoryEvent[]>;
  statement(opts?: { at?: When }): Promise<RenterStatement>;
}
/** react — the event log (push). */
export interface CapReactVerb {
  watch(onState: (s: UsufructCapState) => void, opts?: { intervalMs?: number }): () => void;
  waitFor(predicate: (s: UsufructCapState) => boolean, opts?: { intervalMs?: number; timeoutMs?: number }): Promise<UsufructCapState>;
}
/** write — protocol writes (Plan). */
export interface CapWriteVerb {
  readonly borrow: BorrowMethod;
  transfer(to: string): Plan<{ digest: string }>;
  burn(): Plan<{ digest: string }>;
  burnIfStale(): Promise<{ burned: boolean; digest: string | null }>;
  updateRefundAddress(addr: string): Plan<{ digest: string }>;
}

/** The right of use. The cap is the receiver of its writes — never a hidden arg. */
export interface UsufructCap {
  // identity — the object's name (+ the local mint receipt). Everything else is a verb.
  readonly id: string;
  readonly escrowId: string;
  /** Mint details if this handle came from `rent()`, else `null`. */
  readonly receipt: RentReceipt | null;

  // nav (edge) + the four verbs
  readonly nav: CapNavVerb;
  readonly read: CapReadVerb;
  readonly inspect: CapInspectVerb;
  readonly react: CapReactVerb;
  readonly write: CapWriteVerb;
}

export interface CapArgs {
  readonly capId: string;
  readonly escrowId: string;
  readonly typeArguments: [string, string];
  readonly receipt: RentReceipt | null;
}

/** Build a `UsufructCap` handle bound to its escrow's type args. */
export function createCap(ctx: HandleCtx, args: CapArgs): UsufructCap {
  const { client, packageId, retry } = ctx;
  const ptbArgs = {
    pkg: { packageId },
    escrowId: toId<'Escrow'>(args.escrowId),
    usufructCapId: args.capId,
    typeArguments: args.typeArguments,
  };

  const borrow: BorrowMethod = (...uses: Use[]) =>
    makePlan({
      defaultExecutor: () => ctx.defaultExecutor,
      build: async (tx) => {
        withBorrowedAsset(tx, ptbArgs, compose(uses));
      },
      decode: async (res) => ({ digest: res.digest, returned: true as const }),
    });

  const capPtbArgs = {
    pkg: { packageId },
    escrowId: toId<'Escrow'>(args.escrowId),
    usufructCapId: args.capId,
    typeArguments: args.typeArguments,
  };

  /** A drift-free reader bound to this cap's escrow (cap reads route through it).
   *  Retry-wrapped (like the escrow handle's) so cap reads survive node flakes. */
  const mkReader = (): Reader => {
    const r = createReader(client, {
      packageId,
      escrowId: toId<'Escrow'>(args.escrowId),
      typeArguments: args.typeArguments,
    });
    return retry ? retryingReader(r, retry) : r;
  };

  async function state(opts?: { at?: When }): Promise<UsufructCapState> {
    const reader = mkReader();
    const coinType = args.typeArguments[1];
    // Role in one batched sim — the two seat ids + the stale probe (capId-gated),
    // in parallel with the chain clock.
    const [t, r0] = await Promise.all([
      resolveWhen(client, opts?.at),
      reader.batch(['activeUsufructCapId', 'pendingUsufructCapId', 'usufructCapIsStale'], {
        capId: args.capId,
      }),
    ]);
    const role: UsufructCapRole =
      (r0['activeUsufructCapId'] as string | null) === args.capId
        ? 'active'
        : (r0['pendingUsufructCapId'] as string | null) === args.capId
          ? 'pending'
          : (r0['usufructCapIsStale'] as boolean)
            ? 'stale'
            : 'unknown';
    const none: UsufructCapState = {
      role,
      usufructuaryAddr: null,
      stake: null,
      stakeRemaining: null,
      accruedCredit: null,
      committedTenures: null,
      timeRemainingMs: null,
      creditAccruing: null,
      creditCappedAt: null,
    };
    if (role === 'active') {
      // The active seat's economics in one batched sim (coin metadata in parallel).
      const [coin, s] = await Promise.all([
        resolveCoinInfo(client, coinType),
        reader.batch(
          [
            'activeUsufructuaryAddr', 'activeStakeBalanceMist', 'activeStakeBalanceRemainingMist',
            'accruedCreditMist', 'activeCommittedTenures', 'activeUsufructuaryTimeRemainingMs',
            'creditIsAccruing', 'creditCappedAtMs',
          ],
          { t },
        ),
      ]);
      const stakeMist = s['activeStakeBalanceMist'] as Mist | null;
      const remainMist = s['activeStakeBalanceRemainingMist'] as Mist | null;
      const tenures = s['activeCommittedTenures'] as bigint | null;
      const leftMs = s['activeUsufructuaryTimeRemainingMs'] as bigint | null;
      const cappedAtMs = s['creditCappedAtMs'] as bigint | null;
      return {
        role,
        usufructuaryAddr: s['activeUsufructuaryAddr'] as string | null,
        stake: stakeMist == null ? null : price(stakeMist, coin),
        stakeRemaining: remainMist == null ? null : price(remainMist, coin),
        accruedCredit: price(s['accruedCreditMist'] as Mist, coin),
        committedTenures: tenures == null ? null : Number(tenures),
        timeRemainingMs: leftMs == null ? null : Number(leftMs),
        creditAccruing: s['creditIsAccruing'] as boolean,
        creditCappedAt: cappedAtMs == null ? null : new Date(Number(cappedAtMs)),
      };
    }
    if (role === 'pending') {
      const [coin, s] = await Promise.all([
        resolveCoinInfo(client, coinType),
        reader.batch(['pendingUsufructuaryAddr', 'pendingStakeBalanceMist', 'pendingCommittedTenures']),
      ]);
      const stakeMist = s['pendingStakeBalanceMist'] as Mist | null;
      const tenures = s['pendingCommittedTenures'] as bigint | null;
      return {
        ...none,
        usufructuaryAddr: s['pendingUsufructuaryAddr'] as string | null,
        stake: stakeMist == null ? null : price(stakeMist, coin),
        committedTenures: tenures == null ? null : Number(tenures),
      };
    }
    return none;
  }

  const isActive = (): Promise<boolean> => mkReader().usufructCapIsActive(args.capId);
  const isPending = (): Promise<boolean> => mkReader().usufructCapIsPending(args.capId);
  const isStale = (): Promise<boolean> => mkReader().usufructCapIsStale(args.capId);

  function watch(onState: (s: UsufructCapState) => void, watchOpts?: { intervalMs?: number }): () => void {
    return subscribeEscrowVersion(
      ctx,
      args.escrowId,
      async (alive) => {
        const s = await state();
        if (alive()) onState(s);
      },
      watchOpts,
    );
  }
  async function history(opts?: {
    sender?: string;
    afterCheckpoint?: number;
    beforeCheckpoint?: number;
  }): Promise<HistoryEvent[]> {
    if (ctx.indexer == null) {
      throw new UsufructError('history requires a GraphQL endpoint — pass `graphql` to usufruct()');
    }
    const events = await ctx.indexer.escrowTimeline(toId<'Escrow'>(args.escrowId), {
      ...(opts?.sender !== undefined ? { sender: opts.sender } : {}),
      ...(opts?.afterCheckpoint !== undefined ? { afterCheckpoint: opts.afterCheckpoint } : {}),
      ...(opts?.beforeCheckpoint !== undefined ? { beforeCheckpoint: opts.beforeCheckpoint } : {}),
    });
    // Keep the events that name THIS cap in any id field (mint/borrow/handover/…).
    const want = normEscrowId(args.capId);
    const mentions = (data: Record<string, unknown>): boolean =>
      Object.values(data).some(
        (v) => typeof v === 'string' && v.startsWith('0x') && !v.includes('::') && normEscrowId(v) === want,
      );
    return events.map(toHistoryEvent).filter((he) => mentions(he.data));
  }

  async function statement(opts?: { at?: When }): Promise<RenterStatement> {
    const coin = await resolveCoinInfo(client, args.typeArguments[1]);
    const base = reconstructStatement(await history(), args.capId, coin);
    if (base.status !== 'active') return base; // closed/pending settle in the log
    // Active: the log has not settled it — overlay the live remaining + accrued.
    const t = await resolveWhen(client, opts?.at);
    const s = await mkReader().batch(['activeStakeBalanceRemainingMist', 'accruedCreditMist'], { t });
    const remainMist = s['activeStakeBalanceRemainingMist'] as Mist | null;
    const accruedMist = s['accruedCreditMist'] as Mist | null;
    return {
      ...base,
      consumed: accruedMist == null ? base.consumed : price(accruedMist, coin),
      remaining: remainMist == null ? null : price(remainMist, coin),
    };
  }

  function waitFor(
    predicate: (s: UsufructCapState) => boolean,
    waitOpts?: { intervalMs?: number; timeoutMs?: number },
  ): Promise<UsufructCapState> {
    return new Promise<UsufructCapState>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const stop = watch(
        (s) => {
          if (predicate(s)) {
            stop();
            if (timer) clearTimeout(timer);
            resolve(s);
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

  // A read-then-maybe-write convenience (not a Plan): it only sends when stale.
  async function burnIfStale(): Promise<{ burned: boolean; digest: string | null }> {
    if (!(await mkReader().usufructCapIsStale(args.capId))) return { burned: false, digest: null };
    const { digest } = await digestPlan(
      () => ctx.defaultExecutor,
      (tx) => burnStaleUsufructCapToPtb({ usufructCapId: args.capId })(tx, capPtbArgs),
    ).send();
    return { burned: true, digest };
  }

  const burn = (): Plan<{ digest: string }> =>
    digestPlan(
      () => ctx.defaultExecutor,
      (tx) => burnUsufructCapToPtb(tx, { pkg: { packageId }, usufructCapId: args.capId }),
    );

  const updateRefundAddress = (addr: string): Plan<{ digest: string }> =>
    digestPlan(
      () => ctx.defaultExecutor,
      (tx) =>
        updateUsufructuaryRefundAddressToPtb({ usufructCapId: args.capId, newAddress: addr })(
          tx,
          capPtbArgs,
        ),
    );

  const transfer = transferOf(ctx, args.capId);
  const escrowEdge = (): Promise<Escrow> => createEscrow(ctx, args.escrowId);

  const nav: CapNavVerb = { escrow: escrowEdge };
  const read: CapReadVerb = { state, isActive, isPending, isStale };
  const inspect: CapInspectVerb = { history, statement };
  const react: CapReactVerb = { watch, waitFor };
  const write: CapWriteVerb = { borrow, transfer, burn, burnIfStale, updateRefundAddress };

  return {
    id: args.capId,
    escrowId: args.escrowId,
    receipt: args.receipt,
    nav,
    read,
    inspect,
    react,
    write,
  };
}
