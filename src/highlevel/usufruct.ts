/**
 * `usufruct()` — the entry point and single IO mediator for the high-level
 * API (Layer 2). It hides transport choice / URL / `ClientWithCoreApi`, holds
 * the (optional) signer, and is the door onto the authority graph.
 *
 * Phase A: the factory, client/signer plumbing, and the `primitives` escape
 * hatch. `escrow` / `coin` / `fromBalance` are declared here and implemented in
 * Phases B–C (they throw until then).
 */
import type { ClientWithCoreApi } from '@mysten/sui/client';
import type { Signer } from '@mysten/sui/cryptography';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { TESTNET } from '../config/network.js';
import { chainSource, type Source } from '../primitives/source.js';
import { createReader, type Reader, type ReaderTarget } from '../read/reader.js';
import type { CoinSource } from './coins.js';
import { createEscrow, type Escrow } from './escrow.js';
import type { CoinTag, Price } from './value.js';

export type Network = 'testnet' | 'mainnet' | 'devnet' | 'localnet';

/** Explicit time. Defaults to the fetched chain clock (never the local clock). */
export type When = Date | number | 'now';

const GRPC_URL: Record<Network, string> = {
  testnet: 'https://fullnode.testnet.sui.io:443',
  mainnet: 'https://fullnode.mainnet.sui.io:443',
  devnet: 'https://fullnode.devnet.sui.io:443',
  localnet: 'http://127.0.0.1:9000',
};

export interface UsufructConfig {
  /** Pick a known network (builds a gRPC client). Default `'testnet'`. */
  readonly network?: Network;
  /** Bring your own transport (gRPC / JSON-RPC). Overrides `network`. */
  readonly client?: ClientWithCoreApi;
  /** Required only for writes; reads need none. */
  readonly signer?: Signer;
  /** Defaults to the network's deployed package id. */
  readonly packageId?: string;
}

/** The raw kernel, one property away (escape hatch — SPEC rule #2). */
export interface Primitives {
  readonly source: Source;
  /** Build a drift-free `Reader` for an escrow target (needs its type args). */
  reader(target: ReaderTarget): Reader;
}

export interface Usufruct {
  /** The signer's address, or `null` when read-only. */
  readonly address: string | null;
  /** Wire a wallet/keypair after construction (wallet-standard adapter). */
  connect(signer: Signer): void;

  /** Door: resolve an escrow's state + the signer's role here (one fetch). */
  escrow(id: string, opts?: { at?: When }): Promise<Escrow>;

  /** Opt-in coin sourcer: split an exact amount from your `Coin<C>`. */
  coin(coin: CoinTag, amount: Price): CoinSource;
  /** Opt-in coin sourcer: let the call split exactly what it needs. */
  fromBalance(coin: CoinTag): CoinSource;

  /** The four primitives, untouched. */
  readonly primitives: Primitives;
}

function resolveClient(config: UsufructConfig): ClientWithCoreApi {
  if (config.client) return config.client;
  const network = config.network ?? 'testnet';
  return new SuiGrpcClient({ network, baseUrl: GRPC_URL[network] });
}

/** Construct the entry handle. */
export function usufruct(config: UsufructConfig = {}): Usufruct {
  const client = resolveClient(config);
  const packageId = config.packageId ?? TESTNET.packageId;
  let signer: Signer | null = config.signer ?? null;

  const source = chainSource(client, { packageId });

  const primitives: Primitives = {
    source,
    reader: (target) => createReader(client, target),
  };

  return {
    get address() {
      return signer?.toSuiAddress() ?? null;
    },
    connect(next) {
      signer = next;
    },

    escrow(idStr, opts) {
      return createEscrow(client, packageId, source, signer, idStr, opts?.at);
    },

    coin(coin, amount) {
      return { kind: 'exact', coin, amountMist: amount.mist };
    },
    fromBalance(coin) {
      return { kind: 'minimum', coin };
    },

    primitives,
  };
}
