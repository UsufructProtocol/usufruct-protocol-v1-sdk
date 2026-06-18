# @usufruct-protocol/sim

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)
[![npm](https://img.shields.io/npm/v/@usufruct-protocol/sim.svg)](https://www.npmjs.com/package/@usufruct-protocol/sim)

The **opt-in mirror** for the [Usufruct Protocol SDK](https://www.npmjs.com/package/@usufruct-protocol/sdk)
— the tier that *re-derives* the protocol off-chain.

[`@usufruct-protocol/sdk`](https://www.npmjs.com/package/@usufruct-protocol/sdk) (the
core) is **drift-zero**: it reads every effective value through the on-chain
`Reader`, so it can't drift from the contract — but for the same reason it can only
answer "as of now / at a `t` the chain will evaluate." This package does what the
core can't:

- **Forward simulation across time** and what-if analysis — `Action.step` advances
  `EscrowState` purely at any `(state, t)`, no `&Clock` round-trip.
- **The compute `View<T>` functions** — the protocol's read logic mirrored in TS.
- **The fixed-point curve math** (`curve`) — credit/auction curves, fee split.
- **A fully-offline testbed** — `memorySource` / `memoryInbox`: the whole lifecycle
  (integrate → rent → apply → retire → claim) in RAM, gas-free, with time as an
  explicit parameter.

Because it re-derives, it **takes drift risk** — so every mirror is golden-tested
against the core's `Reader`, its oracle. The dependency is one-way: `sim → sdk`.

## Install

```bash
npm i @usufruct-protocol/sim @usufruct-protocol/sdk @mysten/sui
```

## Use

```ts
import { decodeEscrowState } from '@usufruct-protocol/sim/primitives/state.js';
import { actions, curve, memorySource } from '@usufruct-protocol/sim';

// Re-derive a view / fold an action over a hypothetical future, off-chain:
const next = actions.rent({ tenures: 1 }).step(state, t);

// Or run the whole lifecycle in RAM (no network, no gas):
const store = memorySource();
```

For drift-free reads, writes, discovery, and live events, use the core
(`@usufruct-protocol/sdk`). Reach here only when you need local re-derivation the
chain can't give you.

## License

Apache-2.0
