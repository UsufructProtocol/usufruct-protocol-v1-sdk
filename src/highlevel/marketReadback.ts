/**
 * Read an escrow's current `Market` back from the chain (the inverse of
 * `toEnsembleConfig`). Lets `governanceCap.update` take a `Partial<Market>`:
 * read the current market, merge the changed fields, send the full ensemble.
 */
import type { Reader } from '../read/reader.js';
import type { Commitment as ViewCommitment, CurveShape } from '../views/config.js';
import type { Commitment, ExpAlpha, Market, PowerLawDen, PowerLawNum, Shape } from './market.js';
import { coinInfo, coinTag, price } from './value.js';

function curveToShape(c: CurveShape): Shape {
  switch (c.kind) {
    case 'linear':
    case 'smoothstep':
    case 'logistic':
      return c.kind;
    case 'powerLaw':
      // The chain stored these reduced and in range (num 1..8, den 1..4).
      return { powerLaw: { num: c.alphaNum as PowerLawNum, den: c.alphaDen as PowerLawDen } };
    case 'exponential':
      return { exponential: { alpha: (c.alphaNeg ? -c.alphaAbs : c.alphaAbs) as ExpAlpha } };
  }
}

function viewToCommitment(c: ViewCommitment): Commitment {
  return c.kind === 'immediate' ? 'immediate' : { deferredFor: Number(c.floorMs) };
}

/** The escrow's current market, reconstructed from its on-chain views. */
export async function readMarket(reader: Reader, coinType: string): Promise<Market> {
  const [restPrice, tenure, extend, handover, auction, credit, auctionShape, escalation, retire, ensemble] =
    await Promise.all([
      reader.restPrice(),
      reader.tenureDuration(),
      reader.tenureExtend(),
      reader.handover(),
      reader.auctionWindow(),
      reader.creditShape(),
      reader.auctionShape(),
      reader.priceEscalation(),
      reader.retireCommitment(),
      reader.ensembleCommitment(),
    ]);

  const coin = coinTag(coinInfo(coinType));
  return {
    restPrice: price(restPrice.priceMist, coin),
    tenure: Number(tenure.ceilingMs),
    coin,
    multiTenure: extend.kind === 'multi',
    creditShape: curveToShape(credit),
    auctionShape: curveToShape(auctionShape),
    descent: auction.kind === 'off' ? 'off' : Number(auction.ceilingMs),
    handover:
      handover.kind === 'off' ? 'off' : handover.kind === 'fullTenure' ? 'fullTenure' : Number(handover.floorMs),
    escalation:
      escalation.kind === 'fixedDelta'
        ? { fixed: price(escalation.deltaMist, coin) }
        : { compound: { bps: escalation.bps, delta: price(escalation.deltaMist, coin) } },
    retireCommitment: viewToCommitment(retire),
    ensembleCommitment: viewToCommitment(ensemble),
  };
}
