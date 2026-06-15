/**
 * The shared dependencies every handle carries: the IO client, the deployment,
 * the kernel `Source`, the (optional) signer, and — for non-uid assets (SPEC
 * §10) — the asset BCS schema. Bundled so handles thread one value, not five.
 */
import type { ClientWithCoreApi } from '@mysten/sui/client';
import type { Signer } from '@mysten/sui/cryptography';
import type { Source } from '../primitives/source.js';
import type { AssetSchema } from '../primitives/state.js';

export interface HandleCtx {
  readonly client: ClientWithCoreApi;
  readonly packageId: string;
  readonly source: Source;
  /** Null when read-only; required for writes. */
  readonly signer: Signer | null;
  /** Asset BCS schema for decode/reads; defaults to uid-only when omitted. */
  readonly assetSchema?: AssetSchema;
}
