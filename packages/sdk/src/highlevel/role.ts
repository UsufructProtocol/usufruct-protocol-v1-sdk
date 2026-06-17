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

/** The signer's authority over one escrow — which of its objects they hold. */
export interface RoleResolution {
  /** The active `UsufructCap` id, if the signer holds it (else `null`). */
  readonly capId: string | null;
  /** Whether the signer holds this escrow's `GovernanceCap`. */
  readonly governs: boolean;
  /** Whether the signer holds this escrow's `EarningsInbox`. */
  readonly holdsEarnings: boolean;
}

const NO_ROLE: RoleResolution = { capId: null, governs: false, holdsEarnings: false };

/** Collect the ids of `owner`'s objects of a given Move type (paginated). */
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
  earningsInboxId: string | null,
): Promise<RoleResolution> {
  if (owner == null) return NO_ROLE;

  const empty = Promise.resolve(new Set<string>());
  const [usufructCaps, govCaps, earningsInboxes] = await Promise.all([
    activeCapId != null ? ownedIds(client, owner, `${packageId}::usufruct_cap::UsufructCap`) : empty,
    governanceCapId != null ? ownedIds(client, owner, `${packageId}::governance_cap::GovernanceCap`) : empty,
    earningsInboxId != null ? ownedIds(client, owner, `${packageId}::earnings_inbox::EarningsInbox`) : empty,
  ]);

  return {
    capId: activeCapId != null && usufructCaps.has(activeCapId) ? activeCapId : null,
    governs: governanceCapId != null && govCaps.has(governanceCapId),
    holdsEarnings: earningsInboxId != null && earningsInboxes.has(earningsInboxId),
  };
}
