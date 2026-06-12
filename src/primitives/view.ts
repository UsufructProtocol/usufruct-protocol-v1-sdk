/**
 * ❷ View (SPEC §4.2) — a pure projection over `EscrowState` at an explicit
 * time. One per public view in `escrow.move`; never a method on state.
 */
import type { Ms } from './brand.js';
import type { AssetSchema, EscrowState } from './state.js';

export type View<T> = (state: EscrowState<AssetSchema>, t: Ms) => T;
