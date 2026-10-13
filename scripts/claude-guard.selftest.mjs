// Self-test of claude-guard.mjs: node scripts/claude-guard.selftest.mjs (exit 1 on failure).
// Covers what must be blocked and former false positives (shell sitting in docs/, rm outside the vault).
import { spawnSync } from 'node:child_process';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const GUARD = new URL('./claude-guard.mjs', import.meta.url).pathname;
const SP = '/private/tmp/claude-501/x';

// [expected, cwd, command]
const cases = [
  // must block
  ['block', ROOT, 'rm docs/40-plan/M07-kernel-occt.md'],
  ['block', ROOT, 'rm -rf docs'],
  ['block', ROOT, 'rm -rf ./*'],
  ['block', ROOT, 'rm -rf .'],
  ['block', `${ROOT}/docs`, 'rm 40-plan/M07-kernel-occt.md'],
  ['block', `${ROOT}/docs/40-plan`, 'rm *.md'],
  ['block', SP, `cd ${ROOT}/docs && rm 60-otazky/Q001.md`],
  ['block', ROOT, 'git rm docs/x.md'],
  ['block', ROOT, 'cd docs; rmdir 90-archiv'],
  ['block', ROOT, `rm "${ROOT}/docs/a b.md"`],
  ['block', ROOT, 'rm -- docs/x.md'],
  ['block', ROOT, 'sudo rm docs/x.md'],
  ['block', ROOT, 'rm $DIR/docs/x.md'],
  ['block', ROOT, 'ls && rm -f docs/x.md || true'],
  ['block', `${ROOT}/src`, 'rm -rf ..'],
  // must pass (former false positives)
  ['pass', `${ROOT}/docs`, `cd ${ROOT}/spikes && rm a.mjs`],
  ['pass', `${ROOT}/docs`, `rm ${SP}/a.mjs`],
  ['pass', `${ROOT}/docs`, `cd ${SP} && rm -rf out`],
  ['pass', ROOT, 'rm src/kernel/tmp-probe.ts'],
  ['pass', ROOT, 'rm src/x.ts && cat docs/Domů.md'],
  ['pass', ROOT, 'grep -rn "rm docs" scripts'],
  ['pass', ROOT, 'node scripts/vault-lint.mjs docs'],
  ['pass', ROOT, 'echo "rm docs/x" > /dev/null'],
  ['pass', ROOT, 'npm run format'],
  ['pass', ROOT, `mv ${SP}/a docs/90-archiv/`],
  ['pass', ROOT, 'rm -rf node_modules/.vite'],
];

let failed = 0;
for (const [expected, cwd, command] of cases) {
  const r = spawnSync('node', [GUARD], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd }),
  });
  const got = r.status === 2 ? 'block' : r.status === 0 ? 'pass' : `exit ${r.status}`;
  const ok = got === expected;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${expected.padEnd(5)} got ${got.padEnd(5)} [${cwd.replace(ROOT, '.')}] ${command}`);
}
// Edit/Write rule unchanged
const inbox = spawnSync('node', [GUARD], {
  input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: `${ROOT}/docs/01-inbox/nonexistent-new.md` }, cwd: ROOT }),
});
console.log(`${inbox.status === 0 ? 'ok  ' : 'FAIL'} new inbox file allowed`);
console.log(failed === 0 ? 'ALL OK' : `${failed} FAILED`);
process.exitCode = failed === 0 && inbox.status === 0 ? 0 : 1;
