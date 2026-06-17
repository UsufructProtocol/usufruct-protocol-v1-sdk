/**
 * `@usufruct-protocol/sim` — the opt-in mirror (SPEC §2.1, §6.2).
 *
 * Re-derives the protocol off-chain (`Action.step`, the compute `View<T>`
 * functions, the fixed-point curve, the in-memory testbed) for simulation,
 * what-if analysis, and offline replay — the things the drift-zero core's
 * on-chain `Reader` cannot do. Golden-tested against the core's `Reader`, its
 * oracle (SPEC §8). Depends one-way on `@usufruct-protocol/sdk`.
 */
export * from './sim/index.js';
