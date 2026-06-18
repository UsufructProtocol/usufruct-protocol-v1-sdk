/**
 * The shared dependencies every handle carries: the IO client, the deployment,
 * the kernel `Source`, the (optional) signer, and — for non-uid assets (SPEC
 * §10) — the asset BCS schema. Bundled so handles thread one value, not five.
 */
import type { ClientWithCoreApi } from '@mysten/sui/client';
import type { Signer } from '@mysten/sui/cryptography';
import type { SuiGrpcClient } from '@mysten/sui/grpc';
import type { IndexerSource } from '../indexer/source.js';
import type { RetryOptions } from './retry.js';
import type { Executor } from './send.js';

export interface HandleCtx {
  readonly client: ClientWithCoreApi;
  readonly packageId: string;
  /** The frozen `ProtocolFeeRef` consumed by `integrate`. */
  readonly feeRefId: string;
  /**
   * Identity — *who I am*. Reads use it (role resolution) and build uses it (the
   * transaction sender). Public, so it is known without holding keys (a
   * wallet/Ledger exposes it). Null when fully anonymous.
   */
  readonly account: string | null;
  /**
   * Default signing — *how writes execute*. `Plan.send()` uses it when no
   * `Executor` is passed; null when read-only. A `Signer` config becomes a
   * `signerExecutor(...)` here.
   */
  readonly defaultExecutor: Executor | null;
  /** @deprecated transitional — folded into `account` + `defaultExecutor`. */
  readonly signer: Signer | null;
  /** GraphQL-backed discovery (for `governor.escrows()` byGovernor); optional. */
  readonly indexer?: IndexerSource;
  /** gRPC client for server-push subscriptions (`escrow.watch`); optional. */
  readonly grpcClient?: SuiGrpcClient;
  /**
   * Retry policy for transient reads. When present, the handle's `reader` is
   * wrapped to retry the truncated-`simulateTransaction` shape (the `client` is
   * already retry-wrapped for transient status). Omitted when retry is disabled.
   */
  readonly retry?: RetryOptions;
}
