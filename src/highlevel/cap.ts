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
import { createReader } from '../read/reader.js';
import { transferOf } from './bearer.js';
import type { HandleCtx } from './ctx.js';
import { createEscrow, type Escrow } from './escrow.js';
import { NotConnected, mapAbort } from './errors.js';
import { execute } from './send.js';
import type { Price } from './value.js';

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

/** The right of use. The cap is the receiver of its writes — never a hidden arg. */
export interface UsufructCap {
  readonly id: string;
  readonly escrowId: string;
  /** Mint details if this handle came from `rent()`, else `null`. */
  readonly receipt: RentReceipt | null;
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

  async function burnIfStale(): Promise<{ burned: boolean; digest: string | null }> {
    if (signer == null) throw new NotConnected('burnIfStale requires a signer (it submits a tx)');
    const reader = createReader(client, {
      packageId,
      escrowId: toId<'Escrow'>(args.escrowId),
      typeArguments: args.typeArguments,
    });
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
    borrow,
    transfer: transferOf(ctx, args.capId, 'cap'),
    burnIfStale,
    burn,
    updateRefundAddress,
    escrow: () => createEscrow(ctx, args.escrowId),
  };
}
