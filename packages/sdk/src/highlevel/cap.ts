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
import { withBorrowedAsset } from '../actions/borrow.js';
import {
  burnStaleUsufructCap,
  burnUsufructCapToPtb,
  updateUsufructuaryRefundAddress,
} from '../actions/governance.js';
import { id as toId } from '../primitives/brand.js';
import { createReader, type Reader } from '../read/reader.js';
import { transferOf } from './bearer.js';
import { resolveCoinInfo } from './coinmeta.js';
import { resolveWhen } from './clock.js';
import type { HandleCtx } from './ctx.js';
import { createEscrow, type Escrow } from './escrow.js';
import { NotConnected, mapAbort } from './errors.js';
import { execute } from './send.js';
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

/** The caller's PTB middle: the asset is handed in; the `return` is appended for you. */
export type Use = (asset: TransactionObjectArgument, tx: Transaction) => void;

/** Outcome of a self-driven `borrow` (sign + send). */
export interface BorrowReceipt {
  readonly digest: string;
  readonly returned: true;
}

export interface BorrowMethod {
  /** borrow → your calls → return, signed & sent. */
  (use: Use): Promise<BorrowReceipt>;
  /** Drop the bracket into a PTB you drive (sponsorship / batching). */
  into(tx: Transaction, use: Use): void;
}

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

/** The right of use. The cap is the receiver of its writes — never a hidden arg. */
export interface UsufructCap {
  readonly id: string;
  readonly escrowId: string;
  /** Mint details if this handle came from `rent()`, else `null`. */
  readonly receipt: RentReceipt | null;

  /**
   * This cap's read photo — ask the cap about its own seat (object-centric, the
   * read twin of the writes). One batched fetch against the escrow's views,
   * role-gated: seat numbers are this cap's only while it holds the seat.
   */
  state(opts?: { at?: When }): Promise<UsufructCapState>;
  /** Does this cap hold the active seat right now? (cheap one-off) */
  isActive(): Promise<boolean>;
  /** Is this cap the pending challenger? */
  isPending(): Promise<boolean>;
  /** Has this cap been displaced (stale — burnable)? */
  isStale(): Promise<boolean>;
  /** The keystone bracket — borrow the asset, compose, return (guaranteed). */
  readonly borrow: BorrowMethod;
  /** Hand the right of use (this cap) to another address. */
  transfer(to: string): Promise<{ digest: string }>;
  /**
   * Burn this cap, but only if it's stale (the holder was displaced). Checks the
   * chain first: if the cap is still active/pending it's a no-op (`burned: false`).
   */
  burnIfStale(): Promise<{ burned: boolean; digest: string | null }>;
  /** Voluntarily relinquish the right of use — burn the cap unconditionally. */
  burn(): Promise<{ digest: string }>;
  /** Redirect where this cap's stake refunds on settlement. */
  updateRefundAddress(addr: string): Promise<{ digest: string }>;
  /** Back-edge: re-resolve the escrow this cap belongs to. */
  escrow(): Promise<Escrow>;
}

export interface CapArgs {
  readonly capId: string;
  readonly escrowId: string;
  readonly typeArguments: [string, string];
  readonly receipt: RentReceipt | null;
}

/** Build a `UsufructCap` handle bound to its escrow's type args. */
export function createCap(ctx: HandleCtx, args: CapArgs): UsufructCap {
  const { client, packageId, signer } = ctx;
  const ptbArgs = {
    pkg: { packageId },
    escrowId: toId<'Escrow'>(args.escrowId),
    usufructCapId: args.capId,
    typeArguments: args.typeArguments,
  };

  const borrow = ((use: Use): Promise<BorrowReceipt> => {
    if (signer == null) {
      throw new NotConnected('borrow requires a signer; pass one to usufruct() or u.connect()');
    }
    const tx = new Transaction();
    withBorrowedAsset(tx, ptbArgs, use);
    return execute(client, tx, signer)
      .then((res) => ({ digest: res.digest, returned: true as const }))
      .catch(mapAbort);
  }) as BorrowMethod;

  borrow.into = (tx: Transaction, use: Use): void => {
    withBorrowedAsset(tx, ptbArgs, use);
  };

  const capPtbArgs = {
    pkg: { packageId },
    escrowId: toId<'Escrow'>(args.escrowId),
    usufructCapId: args.capId,
    typeArguments: args.typeArguments,
  };

  /** A drift-free reader bound to this cap's escrow (cap reads route through it). */
  const mkReader = (): Reader =>
    createReader(client, {
      packageId,
      escrowId: toId<'Escrow'>(args.escrowId),
      typeArguments: args.typeArguments,
    });

  async function state(opts?: { at?: When }): Promise<UsufructCapState> {
    const reader = mkReader();
    const [t, activeId, pendingId] = await Promise.all([
      resolveWhen(client, opts?.at),
      reader.activeUsufructCapId(),
      reader.pendingUsufructCapId(),
    ]);
    const coinType = args.typeArguments[1];
    const role: UsufructCapRole =
      activeId === args.capId
        ? 'active'
        : pendingId === args.capId
          ? 'pending'
          : (await reader.usufructCapIsStale(args.capId))
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
      const [coin, addr, stakeMist, remainMist, accruedMist, tenures, leftMs, accruing, cappedAtMs] =
        await Promise.all([
          resolveCoinInfo(client, coinType),
          reader.activeUsufructuaryAddr(),
          reader.activeStakeBalanceMist(),
          reader.activeStakeBalanceRemainingMist(t),
          reader.accruedCreditMist(t),
          reader.activeCommittedTenures(),
          reader.activeUsufructuaryTimeRemainingMs(t),
          reader.creditIsAccruing(),
          reader.creditCappedAtMs(),
        ]);
      return {
        role,
        usufructuaryAddr: addr,
        stake: stakeMist == null ? null : price(stakeMist, coin),
        stakeRemaining: remainMist == null ? null : price(remainMist, coin),
        accruedCredit: price(accruedMist, coin),
        committedTenures: tenures == null ? null : Number(tenures),
        timeRemainingMs: leftMs == null ? null : Number(leftMs),
        creditAccruing: accruing,
        creditCappedAt: cappedAtMs == null ? null : new Date(Number(cappedAtMs)),
      };
    }
    if (role === 'pending') {
      const [coin, addr, stakeMist, tenures] = await Promise.all([
        resolveCoinInfo(client, coinType),
        reader.pendingUsufructuaryAddr(),
        reader.pendingStakeBalanceMist(),
        reader.pendingCommittedTenures(),
      ]);
      return {
        ...none,
        usufructuaryAddr: addr,
        stake: stakeMist == null ? null : price(stakeMist, coin),
        committedTenures: tenures == null ? null : Number(tenures),
      };
    }
    return none;
  }

  const isActive = (): Promise<boolean> => mkReader().usufructCapIsActive(args.capId);
  const isPending = (): Promise<boolean> => mkReader().usufructCapIsPending(args.capId);
  const isStale = (): Promise<boolean> => mkReader().usufructCapIsStale(args.capId);

  async function burnIfStale(): Promise<{ burned: boolean; digest: string | null }> {
    if (signer == null) throw new NotConnected('burnIfStale requires a signer (it submits a tx)');
    const reader = mkReader();
    if (!(await reader.usufructCapIsStale(args.capId))) return { burned: false, digest: null };
    const tx = new Transaction();
    burnStaleUsufructCap({ usufructCapId: args.capId }).toPtb(tx, capPtbArgs);
    const res = await execute(client, tx, signer).catch(mapAbort);
    return { burned: true, digest: res.digest };
  }

  async function burn(): Promise<{ digest: string }> {
    if (signer == null) throw new NotConnected('burn requires a signer (it submits a tx)');
    const tx = new Transaction();
    burnUsufructCapToPtb(tx, { pkg: { packageId }, usufructCapId: args.capId });
    const res = await execute(client, tx, signer).catch(mapAbort);
    return { digest: res.digest };
  }

  async function updateRefundAddress(addr: string): Promise<{ digest: string }> {
    if (signer == null) throw new NotConnected('updateRefundAddress requires a signer (it submits a tx)');
    const tx = new Transaction();
    updateUsufructuaryRefundAddress({ usufructCapId: args.capId, newAddress: addr }).toPtb(tx, capPtbArgs);
    const res = await execute(client, tx, signer).catch(mapAbort);
    return { digest: res.digest };
  }

  return {
    id: args.capId,
    escrowId: args.escrowId,
    receipt: args.receipt,
    state,
    isActive,
    isPending,
    isStale,
    borrow,
    transfer: transferOf(ctx, args.capId, 'cap'),
    burnIfStale,
    burn,
    updateRefundAddress,
    escrow: () => createEscrow(ctx, args.escrowId),
  };
}
