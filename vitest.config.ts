import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Resolve the workspace packages to SOURCE in tests — no build step needed.
// Mirrors the `paths` in tsconfig.json. Order matters: bare specifier before
// the subpath pattern.
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@usufruct-protocol\/sdk$/, replacement: src('./packages/sdk/src/index.ts') },
      { find: /^@usufruct-protocol\/sdk\/(.*)\.js$/, replacement: src('./packages/sdk/src/$1.ts') },
      { find: /^@usufruct-protocol\/sim$/, replacement: src('./packages/sim/src/index.ts') },
      { find: /^@usufruct-protocol\/sim\/(.*)\.js$/, replacement: src('./packages/sim/src/$1.ts') },
    ],
  },
});
