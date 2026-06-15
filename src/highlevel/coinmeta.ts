/**
 * Resolve a coin's display metadata (decimals + symbol) from on-chain
 * `CoinMetadata`, so the dev never hardcodes it. The protocol is coin-agnostic;
 * the SDK must be too — assuming 9 decimals (SUI's) renders every other coin
 * wrong. Results are cached: `CoinMetadata` is immutable, one fetch per type.
 */
import type { ClientWithCoreApi } from '@mysten/sui/client';
import { coinInfo as fallbackCoinInfo, coinTag, type CoinInfo, type CoinTag } from './value.js';

const cache = new Map<string, CoinInfo>();

/** A coin's `CoinInfo`, from its on-chain `CoinMetadata` (cached, SUI short-circuits). */
export async function resolveCoinInfo(client: ClientWithCoreApi, type: string): Promise<CoinInfo> {
  const cached = cache.get(type);
  if (cached) return cached;
  // SUI is known; no round-trip.
  if (/::sui::SUI$/.test(type)) {
    const sui = fallbackCoinInfo(type);
    cache.set(type, sui);
    return sui;
  }
  const res = (await client.core
    .getCoinMetadata({ coinType: type })
    .catch(() => null)) as { coinMetadata?: { decimals: number; symbol: string } | null } | null;
  const meta = res?.coinMetadata;
  // No metadata on chain → best-effort fallback (9 decimals, last-segment symbol).
  const info: CoinInfo = meta ? { type, decimals: meta.decimals, symbol: meta.symbol } : fallbackCoinInfo(type);
  cache.set(type, info);
  return info;
}

/** A {@link CoinTag} for `type`, with decimals/symbol resolved from chain. */
export async function resolveCoinTag(client: ClientWithCoreApi, type: string): Promise<CoinTag> {
  return coinTag(await resolveCoinInfo(client, type));
}
