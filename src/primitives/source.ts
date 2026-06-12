/**
 * ❹ Source (SPEC §4.4) — the single point of IO. Everything below it
 * (`View`, `Action.step`) is pure; nothing downstream knows which transport
 * produced a given `EscrowState`.
 *
 * Note: SPEC sketches `subscribe` as an Observable; the SDK uses the
 * standard `AsyncIterable` to avoid a reactive-library dependency.
 */
import type { ClientWithCoreApi } from '@mysten/sui/client';
import type { Id } from './brand.js';
import type { AssetSchema, EscrowState, uidAssetSchema } from './state.js';
import { decodeEscrowState } from './state.js';

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

/**
 * Live-chain `Source` over any `ClientWithCoreApi` transport (gRPC,
 * JSON-RPC, GraphQL). Prototype scope: `fetch` only — `subscribe`/`query`
 * are explicitly deferred (they validate transport plumbing, not the
 * four-primitive design).
 */
export function chainSource<
  A extends AssetSchema = typeof uidAssetSchema,
  C extends string = string,
>(client: ClientWithCoreApi, opts?: { assetSchema?: A }): Source<A, C> {
  return {
    fetch: async (escrowId) => {
      const { object } = await client.core.getObject({
        objectId: escrowId,
        include: { content: true },
      });
      return decodeEscrowState<A, C>(
        { objectId: object.objectId, type: object.type, content: object.content },
        opts?.assetSchema,
      );
    },
    subscribe: () => {
      throw new Error('NotImplemented: ChainSource.subscribe is deferred (prototype)');
    },
    query: () => {
      throw new Error('NotImplemented: ChainSource.query is deferred (prototype)');
    },
  };
}
