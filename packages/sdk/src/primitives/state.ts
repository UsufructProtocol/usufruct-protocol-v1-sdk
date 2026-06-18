/**
 * Core escrow IO machinery (SPEC §4.4 boundary): the raw `EscrowSnapshot` a
 * `Source` yields, the asset BCS schema config, and the type-tag splitter. The
 * *decoded* model (`EscrowState`/`EscrowData`) and the decoder live in the
 * mirror (`@usufruct-protocol/sim`) — the core reads drift-zero via the
 * `Reader` and never decodes an escrow, so it never names `EscrowState`.
 */
import { bcs, type BcsType } from '@mysten/sui/bcs';

/**
 * BCS schema for the escrowed asset, supplied by the integrator. Mirrors the
 * codegen constraint (`BcsType<any>`). Consumed by the mirror's decoder; the
 * core only threads it as config.
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
