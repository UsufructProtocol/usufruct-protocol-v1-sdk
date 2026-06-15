/**
 * Role resolution (Layer 2). With a signer, `u.escrow(id)` resolves *the
 * signer's* relationship to this escrow in the same fetch, so `cap` / `canGovern`
 * are sync getters (no second round-trip).
 *
 * The escrow names its active `UsufructCap` and its `GovernanceCap` (state
 * views); we then ask the core API whether the signer *owns* those ids
 * (`listOwnedObjects` filtered by the cap type) — the same owned-object lookup
 * `chainSource.query({ byUsufructuary })` uses.
 */
import type { ClientWithCoreApi } from '@mysten/sui/client';

/** The signer's authority over one escrow. */
export interface RoleResolution {
  /** The active `UsufructCap` id, if the signer holds it (else `null`). */
  readonly capId: string | null;
  /** Whether the signer holds this escrow's `GovernanceCap`. */
  readonly governs: boolean;
}

const NO_ROLE: RoleResolution = { capId: null, governs: false };

/** Collect the ids of `owner`'s objects of a given Move type (paginated). */
async function ownedIds(
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

/**
 * Resolve the signer's role over an escrow. `owner` null (read-only) → no role.
 * `activeCapId` / `governanceCapId` come from the escrow's state views.
 */
export async function resolveRole(
  client: ClientWithCoreApi,
  packageId: string,
  owner: string | null,
  activeCapId: string | null,
  governanceCapId: string | null,
): Promise<RoleResolution> {
  if (owner == null) return NO_ROLE;

  const needCap = activeCapId != null;
  const needGov = governanceCapId != null;
  if (!needCap && !needGov) return NO_ROLE;

  const [usufructCaps, govCaps] = await Promise.all([
    needCap ? ownedIds(client, owner, `${packageId}::usufruct_cap::UsufructCap`) : Promise.resolve(new Set<string>()),
    needGov ? ownedIds(client, owner, `${packageId}::governance_cap::GovernanceCap`) : Promise.resolve(new Set<string>()),
  ]);

  return {
    capId: needCap && usufructCaps.has(activeCapId!) ? activeCapId! : null,
    governs: needGov && govCaps.has(governanceCapId!),
  };
}
