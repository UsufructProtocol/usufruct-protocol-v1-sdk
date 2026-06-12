/**
 * Pattern A reads (SPEC §6.2): curve/settlement math evaluated by the
 * deployed Move bytecode via `simulateTransaction`, decoded from BCS return
 * values. These are IO — deliberately *not* `View<T>`; they take a client.
 *
 * Used for math whose bit-exact TypeScript replication carries drift risk.
 */
import { bcs } from '@mysten/sui/bcs';
import type { ClientWithCoreApi } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { normalizeSuiAddress } from '@mysten/sui/utils';
import * as escrowCalls from '../codegen/usufruct/escrow.js';
import type { Id, Mist, Ms } from '../primitives/brand.js';
import { mist } from '../primitives/brand.js';

export interface InspectTarget {
  readonly client: ClientWithCoreApi;
  /** The deployed usufruct package id. */
  readonly packageId: string;
  readonly escrowId: Id<'Escrow'>;
  /** `[assetType, coinType]` — as carried by `EscrowState`. */
  readonly typeArguments: [string, string];
}

/**
 * Run one Move view call in simulation and return the raw BCS bytes of all
 * its return values (a Move tuple return is one `returnValues` entry per
 * component). Inspect functions surface the protocol's own aborts verbatim
 * (§6.2.1) — e.g. `tenure_settlement` aborts on a non-rented escrow.
 */
async function inspectReturns(
  target: InspectTarget,
  call: (tx: Transaction) => void,
  expected: number,
): Promise<Uint8Array[]> {
  const tx = new Transaction();
  // Reads need no real signer; simulation still requires a sender to build.
  tx.setSenderIfNotSet(normalizeSuiAddress('0x0'));
  call(tx);
  const result = await target.client.core.simulateTransaction({
    transaction: tx,
    checksEnabled: false,
    include: { commandResults: true },
  });
  if (result.$kind !== 'Transaction') {
    throw new Error(
      `Pattern A inspect failed: ${result.FailedTransaction?.status.error?.message ?? 'unknown'}`,
    );
  }
  const rets = result.commandResults?.[0]?.returnValues ?? [];
  if (rets.length < expected) {
    throw new Error(`Pattern A inspect returned ${rets.length} values, expected ${expected}`);
  }
  return rets.map((r) => r.bcs);
}

async function inspectU64(
  target: InspectTarget,
  call: (tx: Transaction) => void,
): Promise<bigint> {
  const [ret] = await inspectReturns(target, call, 1);
  return BigInt(bcs.u64().parse(ret!));
}

/** On-chain `escrow::accrued_credit_mist(escrow, now_ms)`. */
export function accruedCreditMist(target: InspectTarget, t: Ms): Promise<Mist> {
  return inspectU64(target, (tx) =>
    tx.add(
      escrowCalls.accruedCreditMist({
        package: target.packageId,
        arguments: [target.escrowId, t],
        typeArguments: target.typeArguments,
      }),
    ),
  ).then(mist);
}

/** On-chain `escrow::floor_price_mist(escrow, now_ms)`. */
export function floorPriceMist(target: InspectTarget, t: Ms): Promise<Mist> {
  return inspectU64(target, (tx) =>
    tx.add(
      escrowCalls.floorPriceMist({
        package: target.packageId,
        arguments: [target.escrowId, t],
        typeArguments: target.typeArguments,
      }),
    ),
  ).then(mist);
}

/** On-chain `escrow::next_floor_price_mist(escrow, total_bid_mist, tenures)`. */
export function nextFloorPriceMist(
  target: InspectTarget,
  totalBidMist: Mist,
  tenures: bigint,
): Promise<Mist> {
  return inspectU64(target, (tx) =>
    tx.add(
      escrowCalls.nextFloorPriceMist({
        package: target.packageId,
        arguments: [target.escrowId, totalBidMist, tenures],
        typeArguments: target.typeArguments,
      }),
    ),
  ).then(mist);
}

export interface HandoverSettlement {
  /** Stake the displaced usufructuary gets back. */
  readonly remainingMist: Mist;
  /** 90% of consumed credit → governor's inbox. */
  readonly governorShareMist: Mist;
  /** 10% protocol fee. */
  readonly feeMist: Mist;
}

/** On-chain `escrow::handover_settlement(escrow, boundary_ms)` — aborts if not rented. */
export async function handoverSettlement(
  target: InspectTarget,
  boundaryMs: Ms,
): Promise<HandoverSettlement> {
  const rets = await inspectReturns(
    target,
    (tx) =>
      tx.add(
        escrowCalls.handoverSettlement({
          package: target.packageId,
          arguments: [target.escrowId, boundaryMs],
          typeArguments: target.typeArguments,
        }),
      ),
    3,
  );
  const u64 = (b: Uint8Array) => mist(bcs.u64().parse(b));
  return {
    remainingMist: u64(rets[0]!),
    governorShareMist: u64(rets[1]!),
    feeMist: u64(rets[2]!),
  };
}

export interface TenureSettlement {
  readonly governorShareMist: Mist;
  readonly feeMist: Mist;
}

/** On-chain `escrow::tenure_settlement(escrow)` — aborts if not rented (protocol abort, §6.2.1). */
export async function tenureSettlement(target: InspectTarget): Promise<TenureSettlement> {
  const rets = await inspectReturns(
    target,
    (tx) =>
      tx.add(
        escrowCalls.tenureSettlement({
          package: target.packageId,
          arguments: [target.escrowId],
          typeArguments: target.typeArguments,
        }),
      ),
    2,
  );
  const u64 = (b: Uint8Array) => mist(bcs.u64().parse(b));
  return { governorShareMist: u64(rets[0]!), feeMist: u64(rets[1]!) };
}

/**
 * On-chain `escrow::active_stake_balance_remaining_mist(escrow, now_ms)` —
 * the remaining component of the handover settlement; null when not rented
 * (mirrors the Move Option return).
 */
export async function activeStakeBalanceRemainingMist(
  target: InspectTarget,
  t: Ms,
): Promise<Mist | null> {
  const rets = await inspectReturns(
    target,
    (tx) =>
      tx.add(
        escrowCalls.activeStakeBalanceRemainingMist({
          package: target.packageId,
          arguments: [target.escrowId, t],
          typeArguments: target.typeArguments,
        }),
      ),
    1,
  );
  const opt = bcs.option(bcs.u64()).parse(rets[0]!);
  return opt == null ? null : mist(opt);
}
