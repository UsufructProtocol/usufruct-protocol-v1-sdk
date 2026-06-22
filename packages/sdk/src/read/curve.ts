/**
 * Curve sampling — reconstruct a parameterized curve (descent floor, credit
 * accrual) drift-zero by running the deployed view over N sample times in a
 * single `simulateTransaction`.
 *
 * The curve's only policy input — its shape — is built on-chain once via the
 * public `ensemble::new_*` facade and reused *by reference* across every sample
 * point (`descent_floor_at` / `used_credit_at` take `&CurveShapePolicy`). So N
 * points cost ⌈N/39⌉ simulations, not N: one constructor command + up to 39
 * view commands per PTB (the 40-command batch ceiling shared with `runSpecs`).
 *
 * The shape is fed either from a live read (`auctionShape`/`creditShape`) or
 * from a past ensemble event (`PolicyEnsembleRegistered`/`EnsembleUpdated`) — both
 * decode to the same `CurveShape` (the reader's `curveShapeFromUnrolled`), so
 * historical and live reconstruction share one constructor mapping.
 */
import { bcs } from '@mysten/sui/bcs';
import type { ClientWithCoreApi } from '@mysten/sui/client';
import { Transaction, type TransactionResult } from '@mysten/sui/transactions';
import { normalizeSuiAddress } from '@mysten/sui/utils';
import * as ens from '../codegen/usufruct/ensemble.js';
import * as ec from '../codegen/usufruct/escrow.js';

const ZERO_SENDER = normalizeSuiAddress('0x0');
const dU64 = (b: Uint8Array) => BigInt(bcs.u64().parse(b));

/** One constructor command + up to 39 view commands ≤ the 40-command ceiling. */
const POINTS_PER_SIM = 39;

/** A curve shape — the sole policy input to the descent/credit views. Mirrors
 *  the reader's `curveShapeFromUnrolled` decode of `CurveShapePolicy`. */
export type CurveShape =
  | { kind: 'linear' }
  | { kind: 'smoothstep' }
  | { kind: 'logistic' }
  | { kind: 'powerLaw'; alphaNum: number; alphaDen: number }
  | { kind: 'exponential'; alphaAbs: number; alphaNeg: boolean };

/** Build the matching `ensemble::new_*` constructor call; its Result is the
 *  `CurveShapePolicy` enum, passed by reference into a curve view. */
export function constructShape(
  pkg: string,
  shape: CurveShape,
): (tx: Transaction) => TransactionResult {
  switch (shape.kind) {
    case 'linear':
      return ens.newLinear({ package: pkg });
    case 'smoothstep':
      return ens.newSmoothstep({ package: pkg });
    case 'logistic':
      return ens.newLogistic({ package: pkg });
    case 'powerLaw':
      return ens.newPowerLaw({ package: pkg, arguments: [shape.alphaNum, shape.alphaDen] });
    case 'exponential':
      return ens.newExponential({ package: pkg, arguments: [shape.alphaAbs, shape.alphaNeg] });
  }
}

/**
 * Sample a policy-parameterized view at each `t`: construct the policy once,
 * append one view call per point reusing it, demux the u64 per command. The
 * constructor occupies `cmd[0]`; samples are `cmd[1..n]`.
 */
async function sampleCurve(
  client: ClientWithCoreApi,
  construct: (tx: Transaction) => TransactionResult,
  viewAt: (tx: Transaction, shape: TransactionResult, t: bigint) => void,
  ts: readonly bigint[],
): Promise<bigint[]> {
  const out: bigint[] = [];
  for (let i = 0; i < ts.length; i += POINTS_PER_SIM) {
    const group = ts.slice(i, i + POINTS_PER_SIM);
    const tx = new Transaction();
    tx.setSenderIfNotSet(ZERO_SENDER);
    const shape = tx.add(construct);
    for (const t of group) viewAt(tx, shape, t);
    const sim = await client.core.simulateTransaction({
      transaction: tx,
      checksEnabled: false,
      include: { commandResults: true },
    });
    if (sim.$kind !== 'Transaction') {
      throw new Error(
        `sampleCurve failed: ${sim.FailedTransaction?.status.error?.message ?? 'unknown'}`,
      );
    }
    const crs = sim.commandResults ?? [];
    for (let k = 0; k < group.length; k++) out.push(dU64(crs[k + 1]!.returnValues[0]!.bcs));
  }
  return out;
}

/** Resolved descent parameters for one auction phase (all event-sourced). */
export interface DescentParams {
  readonly lastAcqMist: bigint;
  readonly phaseStartMs: bigint;
  readonly floorMist: bigint;
  readonly descentMs: bigint;
  readonly shape: CurveShape;
}

/** Sample the Dutch-auction floor `descent_floor_at` at each `t` (ms). */
export function sampleDescentCurve(
  client: ClientWithCoreApi,
  pkg: string,
  p: DescentParams,
  ts: readonly bigint[],
): Promise<bigint[]> {
  return sampleCurve(
    client,
    constructShape(pkg, p.shape),
    (tx, shape, t) =>
      void tx.add(
        ec.descentFloorAt({
          package: pkg,
          arguments: [p.lastAcqMist, p.phaseStartMs, p.floorMist, p.descentMs, shape, t],
        }),
      ),
    ts,
  );
}

/** Resolved credit parameters for one occupied tenure (all event-sourced). */
export interface CreditParams {
  readonly stakeMist: bigint;
  readonly phaseStartMs: bigint;
  readonly ceilingMs: bigint;
  readonly shape: CurveShape;
}

/** Sample the credit accrual `used_credit_at` at each `t` (ms). */
export function sampleCreditCurve(
  client: ClientWithCoreApi,
  pkg: string,
  p: CreditParams,
  ts: readonly bigint[],
): Promise<bigint[]> {
  return sampleCurve(
    client,
    constructShape(pkg, p.shape),
    (tx, shape, t) =>
      void tx.add(
        ec.usedCreditAt({
          package: pkg,
          arguments: [p.stakeMist, p.phaseStartMs, p.ceilingMs, shape, t],
        }),
      ),
    ts,
  );
}

/** A price-escalation policy — the bar's rise per displacement. Mirrors the
 *  reader's `priceEscalation` decode. */
export type Escalation =
  | { kind: 'fixedDelta'; deltaMist: bigint }
  | { kind: 'compoundDelta'; bps: bigint; deltaMist: bigint };

/** Build the matching `ensemble::new_price_*` constructor (its inputs — Price,
 *  BasisPoints — are themselves built on-chain); its Result is the
 *  PriceEscalationPolicy, passed by reference into `ascending_floor_with`. */
function constructEscalation(pkg: string, esc: Escalation): (tx: Transaction) => TransactionResult {
  return (tx) => {
    if (esc.kind === 'fixedDelta') {
      const delta = tx.add(ens.price({ package: pkg, arguments: [esc.deltaMist] }));
      return tx.add(ens.newPriceFixedDelta({ package: pkg, arguments: [delta] }));
    }
    const bps = tx.add(ens.basisPoints({ package: pkg, arguments: [esc.bps] }));
    const delta = tx.add(ens.price({ package: pkg, arguments: [esc.deltaMist] }));
    return tx.add(ens.newPriceCompoundDelta({ package: pkg, arguments: [bps, delta] }));
  };
}

/**
 * The escalation ladder: from `startMist`, the floor a challenger must clear after
 * each successive displacement — `f(start), f(f(start)), …` for `steps` rungs.
 *
 * Each rung is `ascending_floor_with(prev, tenures, &escalation)`; the u64 return of
 * one call feeds the u64 arg of the next, so the whole ladder chains in ONE
 * simulation (the escalation policy is built once, reused by reference). The ladder
 * calls are the last `steps` commands — decode those.
 */
export async function sampleEscalationLadder(
  client: ClientWithCoreApi,
  pkg: string,
  p: { startMist: bigint; tenures: bigint; escalation: Escalation; steps: number },
): Promise<bigint[]> {
  const tx = new Transaction();
  tx.setSenderIfNotSet(ZERO_SENDER);
  const esc = tx.add(constructEscalation(pkg, p.escalation));
  let prev: bigint | TransactionResult = p.startMist;
  for (let k = 0; k < p.steps; k++) {
    prev = tx.add(ec.ascendingFloorWith({ package: pkg, arguments: [prev as never, p.tenures, esc] }));
  }
  const sim = await client.core.simulateTransaction({
    transaction: tx,
    checksEnabled: false,
    include: { commandResults: true },
  });
  if (sim.$kind !== 'Transaction') {
    throw new Error(
      `sampleEscalationLadder failed: ${sim.FailedTransaction?.status.error?.message ?? 'unknown'}`,
    );
  }
  const crs = sim.commandResults ?? [];
  const out: bigint[] = [];
  for (let k = 0; k < p.steps; k++) out.push(dU64(crs[crs.length - p.steps + k]!.returnValues[0]!.bcs));
  return out;
}
