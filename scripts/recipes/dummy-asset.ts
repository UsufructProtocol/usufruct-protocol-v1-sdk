/**
 * Borrow recipes for the `dummy_asset` package — the zone where the code foreign
 * to the SDK lives. Each export is a *factory* `(args) => Use`: a large or
 * parameterised borrow middle, written once here, imported and injected into
 * `cap.borrow` from anywhere. The SDK never sees these calls until they land
 * inside the borrow→return bracket.
 */
import type { Use } from '@usufruct-protocol/sdk';

/** The on-chain package that defines `DummyAsset` (the asset Alice lists). */
export const DUMMY_PKG = '0xa72e830fcb3e688ab3c20ff3cbd0a149cd1b58715709905585e75eb18317a52a';

/**
 * Read the asset's lifetime use count (`uses(&DummyAsset): u64`). No args, so
 * it is a bare `Use`, not a factory.
 */
export const inspectAsset: Use = (asset, tx) => {
  tx.moveCall({ target: `${DUMMY_PKG}::dummy_asset::uses`, arguments: [asset] });
};

/**
 * Use the asset (`use_asset(&mut DummyAsset, &mut TxContext): Coupon`) and send
 * the minted coupon to `recipient`. The factory closes over the address — this
 * is why a bare `Use` is not enough for a reusable recipe.
 */
export const useAndKeepCoupon = (recipient: string): Use => (asset, tx) => {
  const coupon = tx.moveCall({ target: `${DUMMY_PKG}::dummy_asset::use_asset`, arguments: [asset] });
  tx.transferObjects([coupon], recipient);
};
