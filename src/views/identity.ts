/**
 * Identity views — mirror `asset_state::proj_asset_id`,
 * `proj_governance_cap_id`, `proj_active_addr`.
 */
import type { Id } from '../primitives/brand.js';
import { id } from '../primitives/brand.js';
import type { View } from '../primitives/view.js';
import { assetState, core, rentingTerms } from './internal.js';

export const assetId: View<Id<'Asset'>> = (state) => {
  const s = assetState(state);
  if (s.$kind === 'Waiting') {
    // Locked custody embeds the asset object; its first field is the UID.
    const locked =
      s.Waiting.$kind === 'Idle'
        ? s.Waiting.Idle.asset
        : s.Waiting.$kind === 'Descent'
          ? s.Waiting.Descent.asset
          : s.Waiting.Retired.asset;
    const asset = locked.asset as { id?: unknown };
    if (typeof asset?.id !== 'string') {
      throw new Error('Asset schema does not expose a UID `id` field');
    }
    return id<'Asset'>(asset.id);
  }
  const open = s.Renting.$kind === 'Occupied' ? s.Renting.Occupied.asset : s.Renting.Demand.asset;
  return id<'Asset'>(open.identity.asset_id.proj_id);
};

export const governanceCapId: View<Id<'GovernanceCap'>> = (state) =>
  id<'GovernanceCap'>(core(state).governor_seat.identity.cap_identity.id);

export const activeUsufructuaryAddr: View<string | null> = (state) => {
  const terms = rentingTerms(assetState(state));
  return terms === null ? null : terms.active.identity.address.addr;
};

/**
 * Mirrors `asset_type_name` / `coin_type_name`. Move returns the canonical
 * `type_name` form (full 64-hex address, no leading short form); the
 * `EscrowState` type args are normalized the same way at decode time, minus
 * the `0x` prefix Move omits — strip it for exact parity.
 */
export const assetTypeName: View<string> = (state) => moveTypeName(state.assetType);

export const coinTypeName: View<string> = (state) => moveTypeName(state.coinType);

function moveTypeName(typeTag: string): string {
  // Move's type_name has no 0x prefix and pads addresses to 64 lowercase hex
  // chars; module and struct names keep their case.
  return typeTag.replace(/0x([0-9a-fA-F]+)/g, (_m, hex: string) =>
    hex.toLowerCase().padStart(64, '0'),
  );
}
