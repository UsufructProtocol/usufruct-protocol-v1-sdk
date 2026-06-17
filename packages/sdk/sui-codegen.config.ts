import type { SuiCodegenConfig } from '@mysten/codegen';

// L1 substrate (SPEC §4.5): regenerated from the Move sources on demand.
// The Move package lives in a sibling worktree; override with USUFRUCT_MOVE_PATH
// when the layout differs (e.g. CI checkout).
const config: SuiCodegenConfig = {
  output: './src/codegen',
  // NOTE: generation writes `package_summaries/` inside the Move package directory
  // (an artifact of `sui move summary`); that path should be gitignored in the
  // protocol repo. Setting generateSummaries: false does NOT skip it — it requires
  // pre-existing summaries instead.
  packages: [
    {
      package: '@local-pkg/usufruct',
      // Relative to this package dir (`packages/sdk/`); override in CI.
      path: process.env['USUFRUCT_MOVE_PATH'] ?? '../../../../main/usufruct',
    },
  ],
};

export default config;
