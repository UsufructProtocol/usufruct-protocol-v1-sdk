/**
 * ❶ EscrowState (SPEC §4.1) — the BCS-decoded snapshot of an on-chain
 * `Escrow<Asset, CoinType>`. Plain data: no client, no clock, no methods.
 */
import { bcs, type BcsType } from '@mysten/sui/bcs';
import { Escrow } from '../codegen/usufruct/escrow.js';
import { type Id, id } from './brand.js';

/**
 * BCS schema for the escrowed asset, supplied by the integrator. Mirrors the
 * codegen constraint (`BcsType<any>`).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AssetSchema = BcsType<any>;

/**
 * Fallback schema for assets whose only field is `id: UID` (SPEC §10 risk
 * "user-defined BCS layout"). The asset bytes sit mid-struct inside
 * `AssetCustodyOpen/Locked`, so a blind `Uint8Array` fallback cannot work —
 * decoding requires the exact layout. This covers the simplest (and common)
 * shape; anything richer needs its real schema.
 */
export const uidAssetSchema = bcs.struct('UidAsset', { id: bcs.Address });

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

/** Raw inputs for decoding: object id, full type tag, BCS content bytes. */
export interface EscrowSnapshot {
  readonly objectId: string;
  /** Full object type, `…::escrow::Escrow<Asset, CoinType>`. */
  readonly type: string;
  readonly content: Uint8Array;
}

/** Split the two type arguments of an `Escrow<Asset, CoinType>` type tag. */
export function escrowTypeArgs(type: string): [asset: string, coin: string] {
  const open = type.indexOf('<');
  if (open === -1 || !type.endsWith('>')) {
    throw new Error(`Not a generic Escrow type tag: ${type}`);
  }
  const inner = type.slice(open + 1, -1);
  let depth = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === '<') depth++;
    else if (ch === '>') depth--;
    else if (ch === ',' && depth === 0) {
      return [inner.slice(0, i).trim(), inner.slice(i + 1).trim()];
    }
  }
  throw new Error(`Expected two type arguments in: ${type}`);
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

/** Decode a fetched escrow object into an `EscrowState`. Pure. */
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
