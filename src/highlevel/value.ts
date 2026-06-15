/**
 * Value types for the high-level API (Layer 2).
 *
 * The kernel speaks in branded scalars (`Mist`); app code should not. `Price`
 * carries the raw `mist` *and* knows how to render itself in its coin's units,
 * so `${price}` just works and `.mist` stays exact for assertions/PTBs.
 *
 * `SUI` is both the coin-type tag (`SUI.type`) and a constructor (`SUI(0.5)` →
 * `Price`). The same shape generalises to any coin via {@link coinTag}.
 */
import { type Mist, mist } from '../primitives/brand.js';

const MIST_PER_SUI = 1_000_000_000n;

/** How to render an amount of a given coin. */
export interface CoinInfo {
  /** Fully-qualified coin type, e.g. `'0x2::sui::SUI'`. */
  readonly type: string;
  /** Decimal places (SUI = 9). */
  readonly decimals: number;
  /** Display symbol, e.g. `'SUI'`. */
  readonly symbol: string;
}

/** An amount of a payment coin: exact `mist` + how to print it. */
export interface Price {
  readonly mist: Mist;
  readonly coin: CoinInfo;
  /** Whole-coin units as a number — for display/logs only (may lose precision). */
  toSui(): number;
  /** Human string, e.g. `'0.50 SUI'`. */
  format(): string;
  /** Same as {@link format} — so template literals render it. */
  toString(): string;
}

const SUI_INFO: CoinInfo = { type: '0x2::sui::SUI', decimals: 9, symbol: 'SUI' };

/**
 * Best-effort `CoinInfo` from a coin type string: SUI is known; anything else
 * gets its symbol from the last type segment and the default 9 decimals (the
 * chain stores no decimals on the type — exact maths always uses `.mist`).
 */
export function coinInfo(type: string): CoinInfo {
  if (type === SUI_INFO.type || type.endsWith('::sui::SUI')) return SUI_INFO;
  const symbol = type.split('::').pop() ?? type;
  return { type, decimals: 9, symbol };
}

function render(value: bigint, coin: CoinInfo): string {
  const base = 10n ** BigInt(coin.decimals);
  const whole = value / base;
  const frac = value % base;
  // Two-decimal display; `.mist` keeps full precision.
  const fracStr = (Number(frac) / Number(base)).toFixed(2).slice(2);
  return `${whole}.${fracStr} ${coin.symbol}`;
}

/** Construct a `Price` from a raw mist amount, rendered in `coin` (default SUI). */
export function price(value: Mist | bigint, coin: CoinInfo = SUI_INFO): Price {
  const v = mist(value);
  return {
    mist: v,
    coin,
    toSui: () => Number(v) / Number(coin.decimals === 9 ? MIST_PER_SUI : 10n ** BigInt(coin.decimals)),
    format: () => render(v, coin),
    toString: () => render(v, coin),
  };
}

/**
 * A coin tag: callable as a `Price` constructor (`SUI(0.5)`) and carrying the
 * coin's identity (`SUI.type`, `SUI.decimals`, `SUI.symbol`).
 */
export type CoinTag = ((whole: number) => Price) & CoinInfo;

/** Build a {@link CoinTag} for any coin. */
export function coinTag(info: CoinInfo): CoinTag {
  const fn = (whole: number): Price =>
    price(mist(BigInt(Math.round(whole * 10 ** info.decimals))), info);
  return Object.assign(fn, info);
}

/** The SUI coin tag + constructor. */
export const SUI: CoinTag = coinTag(SUI_INFO);
