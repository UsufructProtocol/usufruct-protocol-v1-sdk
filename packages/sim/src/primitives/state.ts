/**
 * ❶ EscrowState (SPEC §4.1) — the BCS-decoded snapshot of an on-chain
 * `Escrow<Asset, CoinType>`. Plain data: no client, no clock, no methods.
 *
 * This is the *mirror's* decoded model. The drift-zero core
 * (`@usufruct-protocol/sdk`) only owns the raw `EscrowSnapshot` (bytes + type
 * tag) and reads through the on-chain `Reader`; it never names `EscrowState`,
 * so the dependency arrow stays sim → sdk. The decoder lives here too.
 */
import { Escrow } from '@usufruct-protocol/sdk/codegen/usufruct/escrow.js';
import { type Id, id } from '@usufruct-protocol/sdk/primitives/brand.js';
import {
  escrowTypeArgs,
  uidAssetSchema,
  type AssetSchema,
  type EscrowSnapshot,
} from '@usufruct-protocol/sdk/primitives/state.js';

type DeepReadonly<T> = T extends (infer U)[]
  ? readonly DeepReadonly<U>[]
  : T extends Uint8Array
    ? Readonly<T>
    : T extends object
      ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
      : T;

/** The decoded `Escrow` material, as inferred from the codegen BCS schema. */
export type EscrowData<A extends AssetSchema> = DeepReadonly<
  ReturnType<typeof Escrow<A>>['$inferType']
>;

/**
 * Snapshot of what the chain knows about one escrow. `A` is the asset BCS
 * schema; `C` is the fully-qualified coin type marker.
 */
export interface EscrowState<
  A extends AssetSchema = typeof uidAssetSchema,
  C extends string = string,
> {
  readonly objectId: Id<'Escrow'>;
  /** Fully-qualified asset type, e.g. `0x…::dummy_asset::DummyAsset`. */
  readonly assetType: string;
  /** Fully-qualified coin type, e.g. `0x2::sui::SUI`. */
  readonly coinType: C;
  readonly escrow: EscrowData<A>;
}

/**
 * Thrown when the decoded value does not re-serialize to the original bytes
 * — almost always a wrong asset schema. BCS is not self-describing: a wrong
 * schema misaligns every field after the asset *silently* (observed live on
 * testnet with `DummyAsset { id, uses }` decoded as uid-only). This
 * invariant turns that silent corruption into an immediate failure.
 */
export class EscrowDecodeError extends Error {
  constructor(type: string, schemaName: string) {
    super(
      `Decoded escrow does not re-serialize to its original bytes. ` +
        `The asset schema "${schemaName}" does not match the asset inside ${type}. ` +
        `Supply the asset's exact BCS schema (uidAssetSchema only fits assets ` +
        `whose sole field is id: UID).`,
    );
    this.name = 'EscrowDecodeError';
  }
}

/** Decode a fetched escrow snapshot into an `EscrowState`. Pure. */
export function decodeEscrowState<
  A extends AssetSchema = typeof uidAssetSchema,
  C extends string = string,
>(snapshot: EscrowSnapshot, assetSchema?: A): EscrowState<A, C> {
  const schema = (assetSchema ?? uidAssetSchema) as A;
  const [assetType, coinType] = escrowTypeArgs(snapshot.type);
  const bcsSchema = Escrow(schema);
  const escrow = bcsSchema.parse(snapshot.content) as EscrowData<A>;

  // Decode invariant (SPEC §10): parse ∘ serialize must be the identity on
  // the original bytes, otherwise the asset schema misaligned the read.
  const reserialized = bcsSchema.serialize(escrow as never).toBytes();
  if (
    reserialized.length !== snapshot.content.length ||
    !reserialized.every((b, i) => b === snapshot.content[i])
  ) {
    throw new EscrowDecodeError(snapshot.type, schema.name);
  }

  return {
    objectId: id<'Escrow'>(snapshot.objectId),
    assetType,
    coinType: coinType as C,
    escrow,
  };
}
