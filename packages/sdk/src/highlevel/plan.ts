/**
 * A write, deferred — the three phases of a transaction made explicit.
 *
 * A write is `build (append the PTB) → execute (sign + send) → decode (effects →
 * typed result)`. Handles used to fuse all three; a `Plan<T>` keeps `build` and
 * `decode` and leaves `execute` to a pluggable `Executor`, so the *same* decode
 * runs whoever signs — wallet, Ledger, sponsor, offline. `build` takes the sender
 * *address* (public, build-time), separate from the signer (execute-time).
 *
 * `Plan<T>` is also a `PromiseLike<T>`: `await escrow.rent(...)` still resolves to
 * the typed result (it delegates to `.send()` with the default signer), so the
 * one-liner is unchanged while the seam opens underneath.
 */
import { Transaction } from '@mysten/sui/transactions';
import { NotConnected } from './errors.js';
import type { Executor, ExecResult } from './send.js';

export interface Plan<T> extends PromiseLike<T> {
  /** Phase 1 — append this write's commands to `tx` for `sender` (async: may source coins). */
  build(tx: Transaction, sender: string): Promise<void>;
  /** Phase 3 — reconstruct the typed result from the execution's effects. */
  decode(res: ExecResult): Promise<T>;
  /** build → execute → decode. Defaults to the handle's signer; pass an `Executor` to swap signing. */
  send(exec?: Executor): Promise<T>;
  /** Build-only: a `Transaction` you sign/send yourself (wallet, Ledger, offline, batching). */
  toTransaction(sender: string): Promise<Transaction>;
}

/** Construct a `Plan<T>` from its build/decode halves plus a lazily-resolved default executor. */
export function makePlan<T>(spec: {
  build: (tx: Transaction, sender: string) => Promise<void>;
  decode: (res: ExecResult) => Promise<T>;
  /** Resolved at send time — `null` when the handle has no signer. */
  defaultExecutor: () => Executor | null;
}): Plan<T> {
  async function toTransaction(sender: string): Promise<Transaction> {
    const tx = new Transaction();
    tx.setSenderIfNotSet(sender);
    await spec.build(tx, sender);
    return tx;
  }

  async function send(exec?: Executor): Promise<T> {
    const ex = exec ?? spec.defaultExecutor();
    if (ex == null) {
      throw new NotConnected('send requires a signer (pass one to usufruct()/connect()) or an Executor');
    }
    const tx = await toTransaction(ex.address);
    const res = await ex.execute(tx);
    return spec.decode(res);
  }

  return {
    build: spec.build,
    decode: spec.decode,
    send,
    toTransaction,
    // PromiseLike: awaiting a Plan runs it with the default executor.
    then: (onFulfilled, onRejected) => send().then(onFulfilled, onRejected),
  };
}

/**
 * The common write whose only result is its digest. `build` appends the PTB
 * command(s); `decode` is just the digest. Most writes (`transfer`, `burn`,
 * `updateMarket`, `retire`, …) are this shape.
 */
export function digestPlan(
  defaultExecutor: () => Executor | null,
  // Returns whatever (e.g. a `toPtb` `TransactionResult`); the value is discarded.
  build: (tx: Transaction, sender: string) => unknown,
): Plan<{ digest: string }> {
  return makePlan({
    defaultExecutor,
    build: async (tx, sender) => {
      await build(tx, sender);
    },
    decode: async (res) => ({ digest: res.digest }),
  });
}
