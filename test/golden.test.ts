/**
 * Offline golden replay: decode the chain-captured fixtures (idle and
 * occupied) and assert every mirrored view reproduces the answers the
 * deployed Move bytecode gave at capture time. Network-free CI gate;
 * shares the parity table with the live e2e harness.
 */
import { readFileSync } from 'node:fs';
import { bcs } from '@mysten/sui/bcs';
import { describe, expect, it } from 'vitest';
import { ms } from '../src/primitives/brand.js';
import { decodeEscrowState } from '../src/primitives/state.js';
import { PARITY_CASES, parityEqual, stable, type ParityCtx } from './parity-cases.js';

interface Fixture {
  packageId: string;
  objectId: string;
  type: string;
  contentBase64: string;
  parity: {
    nowMs: string;
    probeCapId: string;
    results: Record<string, unknown>;
  };
}

const dummyAssetSchema = bcs.struct('DummyAsset', { id: bcs.Address, uses: bcs.u64() });

function loadFixture(name: string): Fixture {
  return JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));
}

for (const file of ['testnet-escrow-1.json', 'testnet-escrow-occupied.json']) {
  describe(`golden replay — ${file}`, () => {
    const fixture = loadFixture(file);
    const state = decodeEscrowState(
      {
        objectId: fixture.objectId,
        type: fixture.type,
        content: Uint8Array.from(Buffer.from(fixture.contentBase64, 'base64')),
      },
      dummyAssetSchema,
    );
    const t = ms(fixture.parity.nowMs);
    const ctx: ParityCtx = {
      packageId: fixture.packageId,
      escrowId: fixture.objectId,
      typeArguments: ['', ''],
      nowMs: BigInt(fixture.parity.nowMs),
      probeCapId: fixture.parity.probeCapId,
    };

    it('decodes the captured escrow bytes', () => {
      expect(state.escrow.core).not.toBeNull();
      expect(state.escrow.state).not.toBeNull();
    });

    it('every parity case has a recorded answer', () => {
      for (const pc of PARITY_CASES) {
        expect(fixture.parity.results, pc.name).toHaveProperty(pc.name);
      }
    });

    for (const pc of PARITY_CASES) {
      it(`reproduces ${pc.name}`, () => {
        const recorded = fixture.parity.results[pc.name];
        const local = pc.local(state, t, ctx);
        expect(parityEqual(local, recorded), `local=${stable(local)} recorded=${stable(recorded)}`).toBe(
          true,
        );
      });
    }
  });
}
