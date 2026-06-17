/**
 * Decode-free type-arg resolution (Layer 2).
 *
 * The high-level only ever needs an escrow's two type arguments
 * (`[assetType, coinType]`) — never the decoded asset bytes. Those come from the
 * object's *type string*, so we read them with a plain `getObject` (no
 * `content`, no BCS, no asset schema). This is why the high-level works for any
 * asset without the developer supplying an `assetSchema`.
 */
import type { ClientWithCoreApi } from '@mysten/sui/client';
import type { Id } from '../primitives/brand.js';
import { escrowTypeArgs } from '../primitives/state.js';

/** An escrow's `[assetType, coinType]`, read from its type string (no decode). */
export async function fetchTypeArgs(
  client: ClientWithCoreApi,
  escrowId: Id<'Escrow'> | string,
): Promise<[string, string]> {
  const { object } = await client.core.getObject({ objectId: escrowId });
  return escrowTypeArgs(object.type);
}
