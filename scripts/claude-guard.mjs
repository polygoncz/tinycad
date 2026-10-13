#!/usr/bin/env node
// Claude Code PreToolUse hook enforcing two vault rules from docs/00-meta/Konvence vaultu.md:
//   - nothing in docs/ is deleted (archive to docs/90-archiv/ instead),
//   - Pavel's notes in docs/01-inbox/ are not rewritten (new files are fine).
// Exit 2 blocks the tool call and shows stderr to Claude. It is a guardrail, not a sandbox.

import { existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const VAULT = resolve(ROOT, 'docs');
const INBOX = resolve(VAULT, '01-inbox');

const inside = (path, dir) => path === dir || path.startsWith(dir + sep);
const block = (msg) => {
  process.stderr.write(`claude-guard: ${msg}\n`);
  process.exit(2);
};

let input = '';
for await (const chunk of process.stdin) input += chunk;
const { tool_name: tool, tool_input: args = {}, cwd = ROOT } = JSON.parse(input || '{}');

if (tool === 'Bash') {
  const cmd = String(args.command ?? '');
  const deletes = /(^|[\s;&|(])(rm|rmdir|unlink|trash|git\s+rm)\s/.test(cmd);
  const touchesVault = /(^|[\s'"=/])docs(\/|\s|$|['"])/.test(cmd) || inside(resolve(cwd), VAULT);
  if (deletes && touchesVault) {
    block('ve vaultu docs/ se nic nemaže. Nepotřebnou poznámku přesuň do docs/90-archiv/ (Konvence vaultu, pravidlo 9).');
  }
}

if (tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit') {
  const file = resolve(cwd, String(args.file_path ?? ''));
  if (inside(file, INBOX) && existsSync(file)) {
    block('poznámky v docs/01-inbox/ jsou Pavlovy a nepřepisují se. Navrhni změnu v chatu nebo poznámku zpracuj do správné složky (Konvence vaultu, pravidlo 7).');
  }
}
