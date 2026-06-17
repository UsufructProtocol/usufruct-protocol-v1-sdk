/**
 * Projection TYPE aliases over the decoded `EscrowState` — the shapes the
 * mirror's view/step helpers consume. Pure type-level derivations of
 * `primitives/state.ts`; no runtime. Live in core so the mirror imports them
 * from one place. See `types/config-types.ts` for the rationale.
 */
import type { AssetSchema, EscrowData } from '../primitives/state.js';

type Escrow = EscrowData<AssetSchema>;

export type AssetStateData = NonNullable<Escrow['state']>;
export type CoreData = NonNullable<Escrow['core']>;
export type EnsembleData = CoreData['ensemble']['active'];
export type RentingData = Extract<AssetStateData, { $kind: 'Renting' }>['Renting'];
export type OccupiedTermsData = Extract<RentingData, { $kind: 'Occupied' }>['Occupied']['terms'];
