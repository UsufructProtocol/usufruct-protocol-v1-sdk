/**
 * The escrow `read` verb's SCALAR half — every single-value on-chain view, auto
 * rendered into the high-level vocabulary (mist→`Price`, ms-timestamp→`Date`,
 * ms-duration/count→`number`) and renamed to drop the now-redundant unit suffix
 * (`floorPriceMist` → `floorPrice`, `tenureExpiryMs` → `expiresAt`).
 *
 * The annotation table below is the single source: it drives BOTH the runtime
 * factory (no per-view hand-wrapper) AND the `ScalarReadVerb` type (a mapped type
 * over the same `const`, key-remapped by `as`, return rendered by `render`). The
 * heterogeneous composites (`assetState`, `market`, `cycle`, the settlements, the
 * curves) are NOT here — `escrow.ts` adds them alongside this scalar surface.
 *
 * Layer: this is Layer 2 (it produces `Price`/`Date`), so it imports the kernel
 * `Reader` downward — never the reverse.
 */
import type { ClientWithCoreApi } from '@mysten/sui/client';
import type { Reader } from '../read/reader.js';
import { resolveWhen } from './clock.js';
import { price, type CoinInfo, type Price } from './value.js';
import type { When } from './usufruct.js';

/** How a raw kernel scalar is lifted into the high-level vocabulary. */
type RenderTag =
  | 'price' // Mist → Price (coin-rendered)
  | 'date' // Ms timestamp → Date
  | 'durationMs' // Ms duration → number (a span, not a clock time)
  | 'count' // u64 cardinal → number
  | 'bps' // basis points → number
  | 'bool'
  | 'string'
  | 'addr'
  | 'id';

type BaseOf<T extends RenderTag> = T extends 'price'
  ? Price
  : T extends 'date'
    ? Date
    : T extends 'durationMs' | 'count' | 'bps'
      ? number
      : T extends 'bool'
        ? boolean
        : string;

/** The call shape a view needs, derived from the kernel arg it threads. */
type ParamKind =
  | 'nullary'
  | 't' // a time-parameterised view: `(at?: When)`
  | 'probe'; // a cap-verification view: `(capId: string)`

type ArgsOf<P extends ParamKind> = P extends 't'
  ? [at?: When]
  : P extends 'probe'
    ? [capId: string]
    : [];

interface Entry {
  /** The kernel `Reader` method this view delegates to. */
  readonly reader: keyof Reader;
  /** The public name on `read.*` (suffix-stripped where the type now carries the unit). */
  readonly as: string;
  readonly render: RenderTag;
  readonly param: ParamKind;
  /** The view returns `T | null` (the rendered type gains `| null`). */
  readonly optional?: boolean;
}

const SCALAR_READS = [
  // ── status ──
  { reader: 'isIdle', as: 'isIdle', render: 'bool', param: 'nullary' },
  { reader: 'isDescending', as: 'isDescending', render: 'bool', param: 'nullary' },
  { reader: 'isOccupied', as: 'isOccupied', render: 'bool', param: 'nullary' },
  { reader: 'isDemand', as: 'isDemand', render: 'bool', param: 'nullary' },
  { reader: 'isLive', as: 'isLive', render: 'bool', param: 'nullary' },
  { reader: 'isRetired', as: 'isRetired', render: 'bool', param: 'nullary' },
  { reader: 'isRented', as: 'isRented', render: 'bool', param: 'nullary' },
  { reader: 'isRetiring', as: 'isRetiring', render: 'bool', param: 'nullary' },

  // ── identity scalars (also reachable as flat identity / nav edges) ──
  { reader: 'assetId', as: 'assetId', render: 'id', param: 'nullary' },
  { reader: 'governanceCapId', as: 'governanceCapId', render: 'id', param: 'nullary' },
  { reader: 'earningsInboxId', as: 'earningsInboxId', render: 'id', param: 'nullary' },
  { reader: 'feeInboxId', as: 'feeInboxId', render: 'id', param: 'nullary' },
  { reader: 'activeUsufructCapId', as: 'activeUsufructCapId', render: 'id', param: 'nullary', optional: true },
  { reader: 'pendingUsufructCapId', as: 'pendingUsufructCapId', render: 'id', param: 'nullary', optional: true },
  { reader: 'activeUsufructuaryAddr', as: 'activeUsufructuary', render: 'addr', param: 'nullary', optional: true },
  { reader: 'pendingUsufructuaryAddr', as: 'pendingUsufructuary', render: 'addr', param: 'nullary', optional: true },
  { reader: 'assetTypeName', as: 'assetTypeName', render: 'string', param: 'nullary' },
  { reader: 'coinTypeName', as: 'coinTypeName', render: 'string', param: 'nullary' },

  // ── seat ──
  { reader: 'activeStakeBalanceMist', as: 'activeStake', render: 'price', param: 'nullary', optional: true },
  { reader: 'pendingStakeBalanceMist', as: 'pendingStake', render: 'price', param: 'nullary', optional: true },
  { reader: 'activeCommittedTenures', as: 'activeCommittedTenures', render: 'count', param: 'nullary', optional: true },
  { reader: 'pendingCommittedTenures', as: 'pendingCommittedTenures', render: 'count', param: 'nullary', optional: true },

  // ── cap verification (probe cap id) ──
  { reader: 'governanceCapIsValid', as: 'governanceCapIsValid', render: 'bool', param: 'probe' },
  { reader: 'usufructCapIsActive', as: 'usufructCapIsActive', render: 'bool', param: 'probe' },
  { reader: 'usufructCapIsPending', as: 'usufructCapIsPending', render: 'bool', param: 'probe' },
  { reader: 'usufructCapIsStale', as: 'usufructCapIsStale', render: 'bool', param: 'probe' },

  // ── temporal ──
  { reader: 'phaseStartMs', as: 'phaseStartAt', render: 'date', param: 'nullary', optional: true },
  { reader: 'tenureExpiryMs', as: 'expiresAt', render: 'date', param: 'nullary', optional: true },
  { reader: 'transitionIsReady', as: 'transitionIsReady', render: 'bool', param: 't' },
  { reader: 'nextTransitionMs', as: 'nextTransitionAt', render: 'date', param: 't', optional: true },
  { reader: 'nextBoundaryMs', as: 'nextBoundaryAt', render: 'date', param: 'nullary', optional: true },
  { reader: 'handoverExpiryMs', as: 'handoverExpiresAt', render: 'date', param: 'nullary', optional: true },
  { reader: 'descentExpiryMs', as: 'descentExpiresAt', render: 'date', param: 'nullary', optional: true },
  { reader: 'activeUsufructuaryTimeRemainingMs', as: 'activeTimeRemaining', render: 'durationMs', param: 't', optional: true },
  { reader: 'handoverExpiryIfBidAt', as: 'handoverExpiresIfBidAt', render: 'date', param: 't', optional: true },
  { reader: 'tenureCeilingMs', as: 'tenureCeiling', render: 'durationMs', param: 'nullary' },
  { reader: 'integratedAtMs', as: 'integratedAt', render: 'date', param: 'nullary' },

  // ── commitments ──
  { reader: 'retireCommitmentUnlocksAtMs', as: 'retireUnlocksAt', render: 'date', param: 'nullary' },
  { reader: 'retireCommitmentAnchorMs', as: 'retireAnchorAt', render: 'date', param: 'nullary' },
  { reader: 'retireCommitmentRemainingMs', as: 'retireRemaining', render: 'durationMs', param: 't' },
  { reader: 'ensembleCommitmentUnlocksAtMs', as: 'ensembleUnlocksAt', render: 'date', param: 'nullary' },
  { reader: 'ensembleCommitmentAnchorMs', as: 'ensembleAnchorAt', render: 'date', param: 'nullary' },
  { reader: 'ensembleCommitmentRemainingMs', as: 'ensembleRemaining', render: 'durationMs', param: 't' },

  // ── credit / auction memory ──
  { reader: 'lastRentPriceMist', as: 'lastRentPrice', render: 'price', param: 'nullary', optional: true },
  { reader: 'creditIsAccruing', as: 'creditIsAccruing', render: 'bool', param: 'nullary' },
  { reader: 'creditIsCapped', as: 'creditIsCapped', render: 'bool', param: 'nullary' },
  { reader: 'creditCappedAtMs', as: 'creditCappedAt', render: 'date', param: 'nullary', optional: true },
  { reader: 'hasPendingEnsembleUpdate', as: 'hasPendingEnsembleUpdate', render: 'bool', param: 'nullary' },

  // ── settlement / curve math (live, time-parameterised) ──
  { reader: 'floorPriceMist', as: 'floorPrice', render: 'price', param: 't' },
  { reader: 'accruedCreditMist', as: 'accruedCredit', render: 'price', param: 't' },
  { reader: 'activeStakeBalanceRemainingMist', as: 'activeStakeRemaining', render: 'price', param: 't', optional: true },

  // ── constants ──
  { reader: 'protocolFeeBps', as: 'protocolFeeBps', render: 'bps', param: 'nullary' },
  { reader: 'bpsDenominator', as: 'bpsDenominator', render: 'count', param: 'nullary' },
] as const satisfies readonly Entry[];

/** The scalar half of `escrow.read.*`, derived from {@link SCALAR_READS}. */
export type ScalarReadVerb = {
  [E in (typeof SCALAR_READS)[number] as E['as']]: (
    ...args: ArgsOf<E['param']>
  ) => Promise<E extends { optional: true } ? BaseOf<E['render']> | null : BaseOf<E['render']>>;
};

/** Build the scalar `read` surface over a bound kernel `Reader` (rendered in `coin`). */
export function createScalarReadVerb(
  reader: Reader,
  coin: CoinInfo,
  client: ClientWithCoreApi,
): ScalarReadVerb {
  const r = reader as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
  const renderOne = (tag: RenderTag, raw: unknown): unknown => {
    if (raw == null) return null;
    switch (tag) {
      case 'price':
        return price(raw as bigint, coin);
      case 'date':
        return new Date(Number(raw as bigint));
      case 'durationMs':
      case 'count':
      case 'bps':
        return Number(raw as bigint);
      default:
        return raw; // bool / string / addr / id pass through
    }
  };

  const out: Record<string, (...a: unknown[]) => Promise<unknown>> = {};
  for (const e of SCALAR_READS) {
    if (e.param === 't') {
      out[e.as] = (at?: unknown) =>
        resolveWhen(client, at as When)
          .then((t) => r[e.reader]!(t))
          .then((v) => renderOne(e.render, v));
    } else if (e.param === 'probe') {
      out[e.as] = (capId: unknown) => r[e.reader]!(capId).then((v) => renderOne(e.render, v));
    } else {
      out[e.as] = () => r[e.reader]!().then((v) => renderOne(e.render, v));
    }
  }
  return out as unknown as ScalarReadVerb;
}
