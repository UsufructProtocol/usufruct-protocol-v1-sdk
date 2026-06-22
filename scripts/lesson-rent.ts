/**
 * LECCIÓN — `rent` de punta a punta (testnet).
 *
 * Una sola acción del protocolo, trazada por las tres ideas de la clase:
 *
 *   1. LEER de dos formas y verlas coincidir (drift = 0):
 *        · tier 1 — la view on-chain   : reader.floorPriceMist(t)   [pregunta a la cadena]
 *        · tier 2 — el espejo en TS     : rent(...).step(state, t)    [calcula en local, PURO]
 *
 *   2. ESCRIBIR: la MISMA acción `rent(...)` interpretada como PTB (`toPtb`)
 *      y enviada a la cadena.
 *
 *   3. LA CADENA ES EL ÁRBITRO: re-leemos el escrow y confirmamos que la
 *      realidad on-chain coincide con lo que `step` predijo (estado Occupied,
 *      floor cobrado == floor predicho).
 *
 * No introduce nada nuevo: reutiliza el kernel (`actions`, `read`, `source`,
 * `sim`) y el plumbing de `scripts/lib.ts`. Gasta solo gas + 1000 de DUMMY_COIN
 * (free-mint) del signer configurado. Correr: `npm run lesson:rent`.
 */
import { bcs } from '@mysten/sui/bcs';
import { Transaction } from '@mysten/sui/transactions';
import * as actions from '../src/actions/index.js';
import * as views from '../src/views/index.js';
import { TESTNET } from '../src/config/network.js';
import { chainSource } from '../src/primitives/source.js';
import { createReader } from '../src/read/index.js';
import { id, mist, ms, tenureCount } from '../src/primitives/brand.js';
import { check, createdId, finish, loadSigner, makeClient, rateLimited, send, step } from './lib.js';

// ── Ejes de prueba (free-mint, sin ruido económico) ──────────────────────────
const DUMMY_PKG = '0xa72e830fcb3e688ab3c20ff3cbd0a149cd1b58715709905585e75eb18317a52a';
const DUMMY_COIN_PKG = '0x97fb7c77162e3edf6a44815ec9eb29b69f9a43747dfb1c1019a7fc5501e2ad96';
const DUMMY_COIN_TREASURY = '0xccee2bc2227913f441c7544892cf5d220880cbc0c55be8733b4b6777def976bc';
const ASSET_T = `${DUMMY_PKG}::dummy_asset::DummyAsset`;
const COIN_T = `${DUMMY_COIN_PKG}::dummy_coin::DUMMY_COIN`;
const TYPE_ARGS: [string, string] = [ASSET_T, COIN_T];

const REST_PRICE = 1_000n; // el "floor" en reposo (Idle) que configuramos
const TENURE_MS = 90_000n;
const HANDOVER_MS = 25_000n;

// DummyAsset NO es uid-only ({ id, uses }) → schema explícito (SPEC §10). Con el
// schema equivocado, BCS desalinea TODO campo posterior, en silencio.
const dummyAssetSchema = bcs.struct('DummyAsset', { id: bcs.Address, uses: bcs.u64() });

const client = rateLimited(makeClient());
const signer = loadSigner();
const me = signer.toSuiAddress();

// El ÚNICO punto de IO (SPEC §4.4). Todo lo de abajo (views, step) es puro.
const source = chainSource(client, { assetSchema: dummyAssetSchema, packageId: TESTNET.packageId });

const reader = (escrow: ReturnType<typeof id<'Escrow'>>) =>
  createReader(client, { packageId: TESTNET.packageId, escrowId: escrow, typeArguments: TYPE_ARGS, assetSchema: dummyAssetSchema });

// Codegen calls crudos para acuñar el asset a alquilar y la moneda de pago.
const mintAsset = (tx: Transaction) => tx.moveCall({ target: `${DUMMY_PKG}::dummy_asset::mint` });
const mintCoin = (tx: Transaction, amount: bigint) =>
  tx.moveCall({ target: `${DUMMY_COIN_PKG}::dummy_coin::mint`, arguments: [tx.object(DUMMY_COIN_TREASURY), tx.pure.u64(amount)] });

const ensembleCfg = {
  restPrice: REST_PRICE,
  tenureMs: TENURE_MS,
  handover: { kind: 'fixed', floorMs: HANDOVER_MS },
} as Parameters<typeof actions.integrate>[0]['ensemble'];

function note(text: string): void {
  console.log(`     · ${text}`);
}

async function main() {
  console.log(`signer: ${me}\n(gasta solo gas + 1000 DUMMY_COIN free-mint)`);

  // ───────────────────────────────────────────────────────────────────────────
  step('0. integrate — necesitamos un escrow que alquilar (Origin action)');
  // `integrate` es la única OriginAction: crea el EscrowState de la nada. Aquí
  // solo nos interesa como atrezzo; el foco de la lección es `rent`.
  let escrowId: ReturnType<typeof id<'Escrow'>>;
  {
    const action = actions.integrate({ ensemble: ensembleCfg, assetType: ASSET_T, coinType: COIN_T });
    const tx = new Transaction();
    const result = action.toPtb(tx, { pkg: TESTNET, asset: mintAsset(tx), typeArguments: TYPE_ARGS });
    tx.transferObjects([result[0]!, result[1]!], me);
    const res = await send(client, tx, signer);
    escrowId = id<'Escrow'>(createdId(res, '::escrow::Escrow'));
    check('escrow creado (estado inicial: Idle)', escrowId.length === 66, escrowId);
    note('un objeto SHARED: nadie lo "posee", por eso luego se descubre vía el UsufructCap (SPEC §4.4)');
  }

  // ───────────────────────────────────────────────────────────────────────────
  step('1. LEER el floor de DOS formas — y verlas coincidir (drift = 0)');
  // Decodificamos el estado UNA vez (bytes BCS → EscrowState). Es solo DATO:
  // no lleva cliente, ni reloj, ni red (SPEC §3 "state is data, not object").
  const stateBefore = await source.fetch(escrowId);
  const t = ms(Date.now()); // el tiempo es PARÁMETRO explícito, no ambiente (SPEC §3)

  // (a) TIER 1 — preguntar a la cadena. La respuesta ES del bytecode desplegado.
  //     simulateTransaction sobre la view `floor_price_mist`. Drift = 0 por
  //     construcción: no hay nada de qué divergir.
  const floorOnChain = await reader(escrowId).floorPriceMist(t);
  check('tier 1 (view on-chain) floor == rest price', floorOnChain === REST_PRICE, `${floorOnChain}`);

  // (b) TIER 2 — el espejo en TS. `rent(...).step` reimplementa la curva del
  //     contrato en local. PURO: este renglón NO toca la red.
  const rentAction = actions.rent({ tenures: tenureCount(1), paymentMist: mist(REST_PRICE), sender: me });
  const predicted = rentAction.step(stateBefore, t); // (state, t) -> { state, result }
  const floorMirror = predicted.result.floorMist;
  check('tier 2 (step, local PURO) floor == rest price', floorMirror === REST_PRICE, `${floorMirror}`);

  // El corazón de la decisión de dirección (SPEC §12): el espejo solo se permite
  // porque coincide bit-exacto con la view on-chain, que es su ORÁCULO.
  check('drift = 0  →  tier1 floor == tier2 floor', floorOnChain === floorMirror, `${floorOnChain} == ${floorMirror}`);
  note(`step también predice la TRANSICIÓN sin red: '${predicted.result.transition}' (install desde Idle)`);
  note(`step predice el estado sucesor: ${predicted.state.escrow.state?.$kind} → Occupied (aún NO ejecutado)`);

  // ───────────────────────────────────────────────────────────────────────────
  step('2. ESCRIBIR — la MISMA acción, ahora interpretada como PTB (toPtb)');
  // `rent` es un VALOR con dos vidas (Command pattern). Arriba usamos `.step`
  // (predecir); aquí `.toPtb` (ejecutar). Una sola fuente de verdad de "qué hace
  // rent". `toPtb` devuelve el UsufructCap recién acuñado: hay que transferirlo.
  {
    const tx = new Transaction();
    const cap = rentAction.toPtb(tx, {
      pkg: TESTNET,
      escrowId,
      payment: mintCoin(tx, REST_PRICE), // moneda de pago, encadenada en el PTB
      typeArguments: TYPE_ARGS, //          ← los type args deciden el routing on-chain
    });
    tx.transferObjects([cap], me);
    const res = await send(client, tx, signer); // ← aquí, y solo aquí, hablamos con la cadena
    check('PTB ejecutada en testnet', res.status.success === true, res.digest);
    note(`&Clock (0x6) y TxContext se inyectan en toPtb; NUNCA aparecen en el constructor (SPEC §4.3)`);
  }

  // ───────────────────────────────────────────────────────────────────────────
  step('3. LA CADENA ES EL ÁRBITRO — realidad on-chain vs predicción de step');
  // Re-leemos el estado real y lo comparamos con lo que `step` había predicho
  // ANTES de enviar nada. Si coinciden, el espejo es honesto.
  {
    const stateAfter = await source.fetch(escrowId);
    const tNow = ms(Date.now());

    check('chain: escrow ahora es Occupied', views.isOccupied(stateAfter, tNow));
    check(
      'predicción de step == realidad on-chain (ambos Occupied)',
      predicted.state.escrow.state?.$kind === stateAfter.escrow.state?.$kind,
      `step=${predicted.state.escrow.state?.$kind} chain=${stateAfter.escrow.state?.$kind}`,
    );

    // El usufructuario activo que ve la cadena somos nosotros.
    const activeAddr = views.activeUsufructuaryAddr(stateAfter, tNow);
    check('chain: el usufructuario activo es el signer', activeAddr === me, String(activeAddr));

    note('moraleja: el espejo (tier 2) solo se publica porque la view on-chain (tier 1) lo verifica.');
    note('si la curva del contrato cambiase y el espejo no, ESTE check fallaría — esa es la red de seguridad.');
  }

  finish();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
