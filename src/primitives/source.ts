/**
 * ❹ Source (SPEC §4.4) — the single point of IO. Everything below it
 * (`View`, `Action.step`) is pure; nothing downstream knows which transport
 * produced a given `EscrowState`.
 *
 * Note: SPEC sketches `subscribe` as an Observable; the SDK uses the
 * standard `AsyncIterable` to avoid a reactive-library dependency.
 */
import type { Id } from './brand.js';
import type { AssetSchema, EscrowState, uidAssetSchema } from './state.js';

/** Discovery predicate for `query`. Prototype scope: by-owner only. */
export interface Predicate {
  readonly byOwner?: string;
}

export interface Source<
  A extends AssetSchema = typeof uidAssetSchema,
  C extends string = string,
> {
  readonly fetch: (id: Id<'Escrow'>) => Promise<EscrowState<A, C>>;
  readonly subscribe: (id: Id<'Escrow'>) => AsyncIterable<EscrowState<A, C>>;
  readonly query: (predicate: Predicate) => AsyncIterable<EscrowState<A, C>>;
}
