/**
 * Resolve the protocol-fee singleton from the deployment's `ProtocolFeeRef`.
 *
 * The `ProtocolFeeInbox` is one object per deployment, created at `init` and
 * `public_transfer`'d to the publisher; the frozen (immutable) `ProtocolFeeRef`
 * pins its id (`proj_id`). So given the configured `feeRefId`, the inbox id is a
 * pure read off that ref — no escrow needed. Mirrors on-chain `fees::inbox_id`.
 */
import type { ClientWithCoreApi } from '@mysten/sui/client';
import { ProtocolFeeRef as ProtocolFeeRefBcs } from '../codegen/usufruct/protocol_fee_ref.js';

/** The `ProtocolFeeInbox` id pinned by the frozen `ProtocolFeeRef`. */
export async function resolveFeeInboxId(client: ClientWithCoreApi, feeRefId: string): Promise<string> {
  const { object } = await client.core.getObject({ objectId: feeRefId, include: { content: true } });
  return ProtocolFeeRefBcs.parse(object.content!).proj_id.id;
}
