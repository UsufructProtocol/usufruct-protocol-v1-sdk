/**
 * The `UsufructCap` handle (Layer 2) — the right of use, and the keystone
 * `borrow`/`return` bracket.
 *
 * The cap is the *receiver* of its writes (never a hidden argument). `borrow`
 * runs the caller's PTB middle between an appended `borrow` and a **guaranteed**
 * `return` — the protocol's reason to exist, made effortless without taking the
 * middle away.
 */
import type { ClientWithCoreApi } from '@mysten/sui/client';
import type { Signer } from '@mysten/sui/cryptography';
import { Transaction, type TransactionObjectArgument } from '@mysten/sui/transactions';
import { withBorrowedAsset } from '../actions/borrow.js';
import { id as toId } from '../primitives/brand.js';
import type { Source } from '../primitives/source.js';
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
export function createCap(
  client: ClientWithCoreApi,
  packageId: string,
  source: Source,
  signer: Signer | null,
  args: CapArgs,
): UsufructCap {
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

  return {
    id: args.capId,
    escrowId: args.escrowId,
    receipt: args.receipt,
    borrow,
    escrow: () => createEscrow(client, packageId, source, signer, args.escrowId),
  };
}
