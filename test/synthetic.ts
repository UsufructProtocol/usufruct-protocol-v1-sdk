/**
 * Synthetic EscrowState builders for offline view/action tests. These encode
 * with the codegen BCS schema and decode through the SDK's own path, so the
 * tests exercise the real decoding pipeline, not a mock.
 */
import { Escrow } from '@usufruct-protocol/sdk/codegen/usufruct/escrow.js';
import {
  decodeEscrowState,
  uidAssetSchema,
  type EscrowState,
} from '@usufruct-protocol/sdk/primitives/state.js';

export const ESCROW_ID = '0x' + 'ab'.repeat(32);
export const ASSET_ID = '0x' + 'cd'.repeat(32);
export const GOVERNOR = '0x' + '11'.repeat(32);
export const INBOX_ID = '0x' + '22'.repeat(32);
export const GOV_CAP_ID = '0x' + '33'.repeat(32);
export const FEE_INBOX = '0x' + '44'.repeat(32);
export const TENANT = '0x' + '55'.repeat(32);
export const TENANT_CAP = '0x' + '66'.repeat(32);

export const defaultEnsemble = {
  rest_price: { Fixed: { price: { mist: 1_000n } } },
  tenure_duration: { Fixed: { ceiling: { ms: 60_000n } } },
  tenure_extend: { Single: true as const },
  handover: { Off: true as const },
  auction_window: { Off: true as const },
  credit_shape: { Linear: true as const },
  auction_shape: { Linear: true as const },
  price_escalation: { FixedDelta: { delta: { mist: 1n } } },
};

export const defaultCore = {
  governor_seat: {
    identity: { cap_identity: { id: GOV_CAP_ID } },
    inbox: { id: INBOX_ID },
  },
  ensemble: { active: defaultEnsemble, pending: null },
  fee_inbox_identity: { id: FEE_INBOX },
  integrated_at: { ms: 1_000n },
  retire_commitment: { policy: { Immediate: true as const }, anchor: { ms: 1_000n } },
  ensemble_commitment: { policy: { Immediate: true as const }, anchor: { ms: 1_000n } },
  escrow_identity: { id: ESCROW_ID },
};

export const defaultCycle = {
  floor: { mist: 1_000n },
  ceiling: { ms: 60_000n },
  handover: { ms: 0n },
  descent: { ms: 30_000n },
};

const openCustody = {
  identity: {
    asset_id: { proj_id: ASSET_ID },
    escrow_identity: { id: ESCROW_ID },
  },
  available: { id: ASSET_ID },
};

/** Multi-tenure knobs: the committed tenure count and the *total* stake. */
export interface TermsOpts {
  readonly committed?: bigint;
  readonly stakeMist?: bigint;
}

export const occupiedTerms = (phaseStartMs: bigint, ceilingMs = 60_000n, opts: TermsOpts = {}) => ({
  schedule: {
    phase_start: { ms: phaseStartMs },
    ceiling_total: { ms: ceilingMs },
    handover_total: { ms: 0n },
    committed_tenures: { count: opts.committed ?? 1n },
  },
  active: {
    identity: {
      cap_identity: { id: TENANT_CAP },
      address: { addr: TENANT },
    },
    stake: { balance: { value: opts.stakeMist ?? 1_000n } },
  },
  retire: { NotRetiring: true as const },
});

type StateVariant = NonNullable<
  Parameters<ReturnType<typeof Escrow<typeof uidAssetSchema>>['serialize']>[0]['state']
>;

export function syntheticState(
  variant: StateVariant,
  core: typeof defaultCore = defaultCore,
): EscrowState<typeof uidAssetSchema> {
  const content = Escrow(uidAssetSchema)
    .serialize({ id: ESCROW_ID, core, state: variant })
    .toBytes();
  return decodeEscrowState({
    objectId: ESCROW_ID,
    type: '0xpkg::escrow::Escrow<0xa::dummy::DummyAsset, 0x2::sui::SUI>',
    content,
  });
}

export const idleState = () =>
  syntheticState({
    Waiting: { Idle: { asset: { asset: { id: ASSET_ID } }, cycle: defaultCycle } },
  });

export const retiredState = () =>
  syntheticState({ Waiting: { Retired: { asset: { asset: { id: ASSET_ID } } } } });

export const descentState = (phaseStartMs: bigint) =>
  syntheticState({
    Waiting: {
      Descent: {
        asset: { asset: { id: ASSET_ID } },
        auction: { last_acq_price: { mist: 1_000n }, phase_start: { ms: phaseStartMs } },
        cycle: defaultCycle,
      },
    },
  });

export const BIDDER = '0x' + '77'.repeat(32);
export const BIDDER_CAP = '0x' + '99'.repeat(32);

/** Demand knobs: active terms (committed/stake) and the incoming bid. */
export interface DemandOpts extends TermsOpts {
  /** Incoming bid's pending stake (total). */
  readonly pendingMist?: bigint;
  /** Incoming bid's committed tenure count. */
  readonly incoming?: bigint;
}

export const demandState = (
  phaseStartMs: bigint,
  handoverExpiryMs: bigint,
  ceilingMs = 60_000n,
  opts: DemandOpts = {},
) =>
  syntheticState({
    Renting: {
      Demand: {
        asset: openCustody,
        terms: occupiedTerms(phaseStartMs, ceilingMs, opts),
        bid: {
          pending: {
            identity: {
              cap_identity: { id: BIDDER_CAP },
              address: { addr: BIDDER },
            },
            stake: { balance: { value: opts.pendingMist ?? 2_000n } },
          },
          handover: { expiry: { ms: handoverExpiryMs }, tenures: { count: opts.incoming ?? 2n } },
        },
        cycle: defaultCycle,
      },
    },
  });

export const occupiedState = (phaseStartMs: bigint, ceilingMs = 60_000n, opts: TermsOpts = {}) =>
  syntheticState({
    Renting: {
      Occupied: {
        asset: openCustody,
        terms: occupiedTerms(phaseStartMs, ceilingMs, opts),
        cycle: defaultCycle,
      },
    },
  });
