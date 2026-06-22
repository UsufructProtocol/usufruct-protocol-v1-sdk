/**
 * Owned-object lookup (Layer 2). Authority in Usufruct is **possession** of a
 * bearer object, so "what can I do here?" is never a permission read — it is
 * whether an address holds the object the escrow names. There is no composite
 * `role()`; the canonical answers come from the protocol's own views
 * (`usufructCapIsActive` / `governanceCapIsValid` / `isRetired`), the cap handle
 * (`cap.read.isActive()`), and discovery (`u.inspect.governedBy/rentedBy`). This
 * module keeps the one primitive those compose over.
 */
import type { ClientWithCoreApi } from '@mysten/sui/client';

/** Collect the ids of `owner`'s objects of a given Move type (paginated) — the
 *  owned-object lookup discovery (`escrowsGovernedBy`…) intersects with the log. */
export async function ownedIds(
  client: ClientWithCoreApi,
  owner: string,
  type: string,
): Promise<Set<string>> {
  const ids = new Set<string>();
  let cursor: string | null = null;
  do {
    const page: Awaited<ReturnType<typeof client.core.listOwnedObjects>> =
      await client.core.listOwnedObjects({ owner, type, cursor, limit: 50 });
    for (const o of page.objects) ids.add(o.objectId);
    cursor = page.hasNextPage ? page.cursor : null;
  } while (cursor);
  return ids;
}
