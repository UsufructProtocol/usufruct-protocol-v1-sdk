/**
 * The chain clock (Layer 2). SPEC rule #3: time is explicit, and the default
 * is the chain's own clock (`0x6`) — never the machine's local clock (local
 * skew silently corrupts boundary maths).
 */
import { bcs } from '@mysten/sui/bcs';
import type { ClientWithCoreApi } from '@mysten/sui/client';
import { type Ms, ms } from '../primitives/brand.js';
import type { When } from './usufruct.js';

const CLOCK = bcs.struct('Clock', { id: bcs.Address, timestamp_ms: bcs.u64() });

/** Read the on-chain `Clock` (`0x6`) timestamp. */
export async function chainNow(client: ClientWithCoreApi): Promise<Ms> {
  const { object } = await client.core.getObject({ objectId: '0x6', include: { content: true } });
  return ms(CLOCK.parse(object.content!).timestamp_ms);
}

/** Resolve a {@link When} to `Ms`, defaulting to (and never silently faking) chain time. */
export async function resolveWhen(client: ClientWithCoreApi, at?: When): Promise<Ms> {
  if (at == null || at === 'now') return chainNow(client);
  if (at instanceof Date) return ms(BigInt(at.getTime()));
  return ms(BigInt(at));
}
