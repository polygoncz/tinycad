#!/usr/bin/env node
// Records the shared test cases (spec 13, Sdílené testovací případy; Q107): runs the shared-case
// runners of the integration project with CASES_RECORD=1, so they write the output of the TS
// domain into `expected` of test/shared-cases/**/*.json instead of comparing it. Since M47 the TS
// runners cover only the kinds ops and sketch (N124); `expected` of new regen and geometry cases
// is written by hand from the output of the C++ core.
//
// Usage: npm run cases:record [-- <extra vitest args>]
//
// A script rather than `CASES_RECORD=1 vitest …` in package.json: an inline env var does not work
// in cmd.exe, and the project has no cross-env.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const vitest = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url));
const result = spawnSync(
  process.execPath,
  [
    vitest,
    'run',
    '--project',
    'integration',
    'test/integration/shared-cases/',
    ...process.argv.slice(2),
  ],
  { stdio: 'inherit', env: { ...process.env, CASES_RECORD: '1' } },
);
process.exit(result.status ?? 1);
