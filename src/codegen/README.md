# Generated — do not edit

L1 substrate (SPEC §4.5): TypeScript types, BCS schemas, and bare `moveCall`
wrappers generated from the Move package sources.

Regenerate with:

```bash
npm run codegen            # uses ../../main/usufruct by default
USUFRUCT_MOVE_PATH=/path/to/usufruct npm run codegen
```

Hand-written code (`src/primitives`, `src/views`, `src/actions`, `src/config`)
imports from this layer; a Move signature change surfaces as a compile error in
the hand-written layer after regeneration.
