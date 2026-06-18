/**
 * Projection TYPE aliases over the decoded `EscrowState` — the shapes the
 * mirror's view/step helpers consume. Pure type-level derivations of the
 * mirror's `primitives/state.ts`; no runtime. Live in the mirror (`sim`)
 * because the decoded model lives here; the core never names `EscrowData`.
 */
import type { AssetSchema } from '@usufruct-protocol/sdk/primitives/state.js';
import type { EscrowData } from '../primitives/state.js';

type Escrow = EscrowData<AssetSchema>;

export type AssetStateData = NonNullable<Escrow['state']>;
export type CoreData = NonNullable<Escrow['core']>;
export type EnsembleData = CoreData['ensemble']['active'];
export type RentingData = Extract<AssetStateData, { $kind: 'Renting' }>['Renting'];
export type OccupiedTermsData = Extract<RentingData, { $kind: 'Occupied' }>['Occupied']['terms'];
