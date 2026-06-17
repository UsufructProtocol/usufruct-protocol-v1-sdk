/**
 * Branded scalar types (SPEC §5): zero-runtime-overhead mirrors of the Move
 * domain types (`Price`, `Timestamp`, `Duration`, `Bps`, …).
 */

declare const brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [brand]: B };

/** Milliseconds since epoch — the explicit time parameter (SPEC §3). */
export type Ms = Brand<bigint, 'Ms'>;
/** A MIST amount (10^-9 of the payment coin). */
export type Mist = Brand<bigint, 'Mist'>;
/** Basis points (1/10_000). */
export type Bps = Brand<bigint, 'Bps'>;
/** A tenure count. */
export type TenureCount = Brand<bigint, 'TenureCount'>;
/** Branded object id. `T` names the on-chain type it identifies. */
export type Id<T extends string = string> = Brand<string, `Id:${T}`>;

export const ms = (v: bigint | number | string): Ms => BigInt(v) as Ms;
export const mist = (v: bigint | number | string): Mist => BigInt(v) as Mist;
export const bps = (v: bigint | number | string): Bps => BigInt(v) as Bps;
export const tenureCount = (v: bigint | number | string): TenureCount =>
  BigInt(v) as TenureCount;
export const id = <T extends string>(v: string): Id<T> => v as Id<T>;
