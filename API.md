# API reference — `@usufruct-protocol/sdk`

The complete public surface. Every object is its **identity** (flat fields) plus
five verbs — **`nav · read · inspect · react · write`**. Everything that touches the
chain is `async`. See [`concepts/api-design.md`](./concepts/api-design.md) for the
model, [`concepts/write-model.md`](./concepts/write-model.md) for the `Plan` write
seam, [`concepts/borrow.md`](./concepts/borrow.md) for `borrow`.

## Entry point

```ts
function usufruct(config?: UsufructConfig): Usufruct;

interface UsufructConfig {
  network?: 'testnet' | 'mainnet' | 'devnet' | 'localnet';   // default 'testnet'
  client?: ClientWithCoreApi;                  // default: a SuiGrpcClient for the network
  signer?: Signer;                             // identity + signing (a held keypair)
  account?: string;                            // identity only (read-only / external wallet)
  executor?: Executor;                         // signing adapter (wallet/Ledger/sponsor/multisig)
  packageId?: string;                          // default: the network's
  feeRefId?: string;                           // default: the network's
  graphql?: string | SuiGraphQLClient | false; // default: from network; false disables inspect.*
  retry?: { attempts?: number; baseMs?: number } | false;   // default on
}

interface Usufruct {
  readonly address: string | null;             // identity (null = anonymous)
  readonly nav: RootNavVerb;
  readonly read: RootReadVerb;
  readonly inspect: RootInspectVerb;
  readonly react: RootReactVerb;
  readonly write: RootWriteVerb;
  connect(signerOrExecutor: Signer | Executor): void;
  coinType(type: string): Promise<CoinTag>;
  batch<T extends readonly Plan<unknown>[]>(...plans: T): Plan<{ [K in keyof T]: T[K] extends Plan<infer U> ? U : never }>;
  readonly primitives: { source: Source; reader(target: ReaderTarget): Reader };
}
```

**Identity & signing** resolve as: `account ?? executor?.address ?? signer?.toSuiAddress()`
for identity; `executor ?? signerExecutor(signer)` for the default executor (override
per write with `.send(executor)`). See [`concepts/write-model.md`](./concepts/write-model.md).

### Root verbs (`u.*`)

```ts
interface RootNavVerb {
  escrow(id: string, opts?: { at?: When }): Promise<Escrow>;
  escrows(ids: string[], opts?: { at?: When }): Promise<Escrow[]>;
  usufructCap(id: string): Promise<UsufructCap>;
  governanceCap(id: string): GovernanceCap;
  earningsInbox(id: string): EarningsInbox;
  feeInbox(id?: string): Promise<ProtocolFeeInbox>;       // id-less → the deployment singleton
}
interface RootReadVerb { protocolFeeBps(): Promise<number>; bpsDenominator(): Promise<number>; }
interface RootInspectVerb {   // all → Promise<EscrowListing[]>; need graphql
  integratedBy(integrator: string); governedBy(holder: string); rentedBy(holder: string);
  governedByCap(governanceCapId: string); byAssetType(assetType: string); byCoinType(coinType: string);
}
interface RootReactVerb { watchMany(ids: string[], onChange: (e: Escrow) => void, opts?: { intervalMs?: number }): PortfolioWatch; }
interface RootWriteVerb {
  integrate(args: {
    asset: string; coin: CoinTag; market: Market;
    to?: { governanceCap?: string; earningsInbox?: string };   // default: the sender for each
  }): Plan<{ escrow: Escrow; governanceCap: GovernanceCap; earningsInbox: EarningsInbox }>;
}
```

## Escrow

```ts
interface Escrow {
  readonly id: string; readonly assetType: string; readonly coinType: string; readonly coin: CoinTag; // identity
  readonly nav: EscrowNavVerb; readonly read: EscrowReadVerb;
  readonly inspect: EscrowInspectVerb; readonly react: EscrowReactVerb; readonly write: EscrowWriteVerb;
}

interface EscrowNavVerb {
  activeCap(): Promise<UsufructCap | null>; pendingCap(): Promise<UsufructCap | null>;
  governanceCap(): Promise<GovernanceCap>; earningsInbox(): Promise<EarningsInbox>; feeInbox(): Promise<ProtocolFeeInbox>;
}

// read = the 53 auto-rendered scalar views (below) + these composites:
type EscrowReadVerb = ScalarReadVerb & {
  assetState(at?: When): Promise<AssetState>;
  snapshot(at?: When): Promise<EscrowSnapshot>;     // a coherent cross-section at one t
  coin(): Promise<CoinTag>;
  market(): Promise<Market>;
  cycle(): Promise<CyclePreview | null>;
  tenureSettlement(): Promise<TenureSettlement>;
  handoverSettlement(boundary: When): Promise<HandoverSettlement>;
  nextFloorPrice(totalBid: Price, tenures: number): Promise<Price>;
  escalationLadder(opts?: { steps?: number; tenures?: number; from?: Price }): Promise<LadderRung[]>;
  creditCurve(opts?: CurveOpts): Promise<CreditSegment | null>;   // the CURRENT tenure, sampled live
  descentCurve(opts?: CurveOpts): Promise<DescentSegment | null>;
};

interface EscrowInspectVerb {       // need graphql
  history(opts?: { sender?: string; afterCheckpoint?: number; beforeCheckpoint?: number }): Promise<HistoryEvent[]>;
  priceTimeline(opts?: CurveOpts): Promise<TimelineSegment[]>;
  creditHistory(opts?: CurveOpts): Promise<CreditSegment[]>;
  tenancies(opts?: { sender?: string; afterCheckpoint?: number; beforeCheckpoint?: number }): Promise<Tenancy[]>;
  usufructCaps(): Promise<UsufructCapRecord[]>;
}

interface EscrowReactVerb {
  watch(onChange: (escrow: Escrow) => void, opts?: { intervalMs?: number }): () => void;
  waitFor(predicate: (escrow: Escrow) => boolean | Promise<boolean>, opts?: { intervalMs?: number; timeoutMs?: number }): Promise<Escrow>;
  onEvents(onEvent: (e: HistoryEvent) => void, opts?: { kinds?: readonly string[]; where?: (e: HistoryEvent) => boolean }): () => void;
  on(kind: string, onEvent: (e: HistoryEvent) => void): () => void;
  nextEvent(opts?: { kinds?: readonly string[]; where?: (e: HistoryEvent) => boolean; timeoutMs?: number }): Promise<HistoryEvent>;
  next(kind: string, opts?: { where?: (e: HistoryEvent) => boolean; timeoutMs?: number }): Promise<HistoryEvent>;
}

interface EscrowWriteVerb {
  rent(args: { tenures: number; pay?: Price; to?: string }): Plan<UsufructCap>;  // to → cap destination (default sender)
  applyPendingTransitionStates(): Plan<{ digest: string }>;
}
```

**`ScalarReadVerb`** — the 53 auto-rendered views (mist→`Price`, ms-timestamp→`Date`,
ms-duration/count→`number`):

```ts
// status
isIdle/isDescending/isOccupied/isDemand/isLive/isRetired/isRented/isRetiring(): Promise<boolean>;
// ids / names
assetId/governanceCapId/earningsInboxId/feeInboxId(): Promise<string>;
activeUsufructCapId/pendingUsufructCapId/activeUsufructuary/pendingUsufructuary(): Promise<string | null>;
assetTypeName/coinTypeName(): Promise<string>;
// seat
activeStake/pendingStake(): Promise<Price | null>;
activeCommittedTenures/pendingCommittedTenures(): Promise<number | null>;
// cap verification (probe by id)
governanceCapIsValid/usufructCapIsActive/usufructCapIsPending/usufructCapIsStale(capId: string): Promise<boolean>;
// temporal
phaseStartAt/expiresAt/handoverExpiresAt/descentExpiresAt/nextBoundaryAt(): Promise<Date | null>;
transitionIsReady(at?: When): Promise<boolean>;
nextTransitionAt/handoverExpiresIfBidAt(at?: When): Promise<Date | null>;
activeTimeRemaining(at?: When): Promise<number | null>;
tenureCeiling(): Promise<number>;
integratedAt/retireUnlocksAt/retireAnchorAt/ensembleUnlocksAt/ensembleAnchorAt(): Promise<Date>;
retireRemaining/ensembleRemaining(at?: When): Promise<number>;
// credit / auction memory
lastRentPrice(): Promise<Price | null>;
creditIsAccruing/creditIsCapped/hasPendingEnsembleUpdate(): Promise<boolean>;
creditCappedAt(): Promise<Date | null>;
// settlement / curve math (live, time-parameterised)
floorPrice/accruedCredit(at?: When): Promise<Price>;
activeStakeRemaining(at?: When): Promise<Price | null>;
// constants
protocolFeeBps/bpsDenominator(): Promise<number>;
```

## UsufructCap

```ts
interface UsufructCap {
  readonly id: string; readonly escrowId: string; readonly receipt: RentReceipt | null;  // identity
  readonly nav: { escrow(): Promise<Escrow> };
  readonly read: {
    state(opts?: { at?: When }): Promise<UsufructCapState>;
    isActive(): Promise<boolean>; isPending(): Promise<boolean>; isStale(): Promise<boolean>;
  };
  readonly inspect: { history(opts?: {...}): Promise<HistoryEvent[]>; statement(opts?: { at?: When }): Promise<RenterStatement> };
  readonly react: {
    watch(cb: (s: UsufructCapState) => void, opts?): () => void;
    waitFor(pred: (s: UsufructCapState) => boolean, opts?): Promise<UsufructCapState>;
  };
  readonly write: {
    readonly borrow: (...uses: Use[]) => Plan<BorrowReceipt>;   // Use = (asset, tx) => void
    transfer(to: string): Plan<{ digest: string }>;
    burn(): Plan<{ digest: string }>;
    burnIfStale(): Promise<{ burned: boolean; digest: string | null }>;   // NOT a Plan — sends only if stale
    updateRefundAddress(addr: string): Plan<{ digest: string }>;
  };
}

type UsufructCapStatus = 'active' | 'pending' | 'stale';   // exhaustive; state() throws on a bogus cap/escrow
interface UsufructCapState {
  status: UsufructCapStatus;
  usufructuaryAddr: string | null; stake: Price | null; stakeRemaining: Price | null;
  accruedCredit: Price | null; committedTenures: number | null; timeRemainingMs: number | null;
  creditAccruing: boolean | null; creditCappedAt: Date | null;
}
interface RentReceipt { paid: Price; expiresAt: Date; digest: string }
type Use = (asset: TransactionObjectArgument, tx: Transaction) => void;
interface BorrowReceipt { digest: string; returned: true }
```

## GovernanceCap

```ts
interface GovernanceCap {
  readonly capId: string;   // identity (no nav)
  readonly read: { governs(escrow: EscrowRef): Promise<boolean> };
  readonly inspect: { escrows(): Promise<EscrowListing[]>; revenueByEscrow(opts?): Promise<EscrowRevenue[]> };
  readonly react: { watch(cb: (e: Escrow) => void, opts?): Promise<PortfolioWatch> };
  readonly write: {
    updateMarket(escrow: EscrowRef, changes: Partial<Market>): Plan<{ digest: string }>;
    retire(escrow: EscrowRef): Plan<{ digest: string }>;
    claim(escrow: EscrowRef, opts?: { to?: string }): Plan<{ assetId: string; digest: string }>; // to → asset destination
    extendRetireCommitment(escrow: EscrowRef, until: Commitment): Plan<{ digest: string }>;
    extendEnsembleCommitment(escrow: EscrowRef, until: Commitment): Plan<{ digest: string }>;
    renounceGovernance(): Plan<{ digest: string }>;        // irreversible burn of the cap
    transfer(to: string): Plan<{ digest: string }>;
    integrateIntoPortfolio(asset: string, coin: CoinTag, market: Market, opts: { earningsInbox: string }): Plan<Escrow>;
  };
}
type EscrowRef = string | Escrow;
```

## EarningsInbox / ProtocolFeeInbox

```ts
interface Inbox {   // EarningsInbox and ProtocolFeeInbox share the shape
  readonly inboxId: string;   // identity (no nav)
  readonly read: { balance(): Promise<Array<{ coin: string; amount: Price }>> };
  readonly inspect: { history(opts?): Promise<InboxMessage[]>; totals(opts?): Promise<InboxTotal[]>; escrowsPushingMessages(): Promise<EscrowListing[]> };
  readonly react: { watch(onMessage: (m: InboxMessage) => void): () => void };
  readonly write: {
    collect(): Plan<Array<{ coin: string; amount: Price }>>;  // partitioned by coin (§5.2) — one PTB per coin type
    transfer(to: string): Plan<{ digest: string }>;
  };
}
interface InboxMessage { coin: string; amount: Price; escrowId: string | null; at: Date | null }
interface InboxTotal { coin: string; total: Price; count: number }
```

## Data types

```ts
type AssetState =
  | { kind: 'idle';     floor: Price }
  | { kind: 'occupied'; cap: string; usufructuary: string; stake: Price; expiresAt: Date }
  | { kind: 'demand';   cap: string; usufructuary: string; challengerCap: string; challenger: string; bid: Price; handoverExpiresAt: Date }
  | { kind: 'descent';  from: Price; floor: Price; expiresAt: Date }
  | { kind: 'retired' };
interface EscrowSnapshot { at: Date; state: AssetState }

interface Market {
  restPrice: Price; tenure: Duration; multiTenure: boolean;
  creditShape: Shape; auctionShape: Shape;
  descent: 'off' | Duration; handover: 'off' | 'fullTenure' | Duration;
  escalation: { fixed: Price } | { compound: { bps: number | bigint; delta: Price } };
  retireCommitment: Commitment; ensembleCommitment: Commitment;
}
type Duration = `${number}${'ms' | 's' | 'm' | 'h' | 'd'}` | number;   // string suffix or raw ms
type Shape = 'linear' | 'smoothstep' | 'logistic' | { powerLaw: { num; den } } | { exponential: { alpha } };
type Commitment = 'immediate' | { deferredFor: Duration };

interface Price { mist: bigint; coin: CoinInfo; toSui(): number; plus(o: Price): Price; scale(f: number): Price; format(): string; toString(): string }
type CoinTag = ((whole: number) => Price) & CoinInfo;        // callable: SUI(0.5) → a Price
interface CoinInfo { type: string; decimals: number; symbol: string }

interface Plan<T> {
  send(exec?: Executor): Promise<T>;            // build + sign + decode (one tx)
  build(tx: Transaction, sender: string): Promise<void>;     // append to your tx
  toTransaction(sender: string): Promise<Transaction>;       // unsigned PTB
  decode(res: ExecResult): Promise<T>;
}
interface Executor { address: string; execute(tx: Transaction): Promise<ExecResult> }

// inspect / curve result shapes
interface CreditSegment { capId: string | null; principal: Price; shape: CurveShape; startedAt: Date; ceilingMs: number; points: CurvePoint[] }
interface DescentSegment { shape: CurveShape; startedAt: Date; descentMs: number; from: Price; to: Price; points: CurvePoint[] }
type TimelineSegment = PriceMarker | ({ kind: 'descent'; at: Date } & DescentSegment);
interface CurvePoint { atMs: number; offsetMs: number; value: Price }
interface LadderRung { step: number; price: Price }
interface CurveOpts { points?: number }
interface RenterStatement { capId: string; paid: Price; refunded: Price; consumed: Price; remaining: Price | null; status: RenterStatus }
interface Tenancy { capId; usufructuary: string; startedAt: Date; endedAt: Date | null; acquired: Price; ceilingMs: number; usedCredit: Price | null; refund: Price | null; governorShare: Price | null; protocolFee: Price | null }
interface EscrowRevenue { escrowId: string; earnings: { coin: string; total: Price; count: number }[] }
type When = Date | number | 'now';
interface EscrowListing { /* id + type + governanceCapId, decode-free */ }
interface HistoryEvent { kind: string; data: Record<string, unknown>; at: Date | null; by: string | null }
```

## Top-level exports

```ts
// value construction
SUI: CoinTag;  price(mist, coin?): Price;  coinTag(info): CoinTag;  coinInfo(type): CoinInfo;
duration(d: Duration): Ms;  toEnsembleConfig(market): …;
// signing
signerExecutor(client, signer): Executor;  walletExecutor(client, wallet, account): Executor;  executeSigned(client, bytes, sigs): Promise<ExecResult>;
// possession (there is no role())
ownedIds(client, owner, type): Promise<Set<string>>;
// resilience (retry, on by default)
withRetry, retryingClient, retryingReader, retryingGraphqlClient, isTransientStatus, isTransientNetwork, …;
// typed errors
UsufructError, MoveAbortError, InsufficientBalance, InsufficientPayment, NotAvailable, NotConnected,
CommittedEnsemble, CommittedRetire, NotGovernor, InvalidEscalation, InvalidShape, InvalidMarket;
MOVE_ABORTS;
```

## Pitfalls (the chain is the arbiter)

- **`inspect.*` needs `graphql`.** It defaults from the network; pass `graphql: false`
  to disable (then `inspect.*` throws a clear error). `read`/`write`/`react` don't need it.
- **`collect` is partitioned by coin type.** A coin-polymorphic inbox emits one PTB
  per `C`; a mismatched `Receiving<T>` aborts in `0x2::transfer::receive_impl`.
- **`borrow` middles take the asset by reference** (`&Asset`/`&mut Asset`). The rare
  by-value-and-return-intact case drops to the primitives — see [`concepts/borrow.md`](./concepts/borrow.md).
- **Dependent writes need separate txs.** `rent` → wait the handover window → `borrow`
  cannot share one PTB; `u.batch`/`build` only compose *independent* writes.
- **`u.batch` collides on same-type mints.** Batching two `rent`s executes atomically
  but the returned handles can't be attributed from shared effects — use separate `.send()`s.
- **Reads are live, lazy.** No fetch-time photo; each `read.*` hits the chain. Take a
  coherent cross-section with `escrow.read.snapshot()`.
