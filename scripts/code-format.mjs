#!/usr/bin/env node
// Claude Code PostToolUse hook for application code: after Claude edits
// src/**/*.{ts,vue} or test/**/*.{ts,vue} it runs `prettier --write` and `eslint --fix` on that file.
// Problems ESLint cannot fix are reported back to Claude (exit 2) to be fixed.
//
// Usage: node scripts/code-format.mjs --hook   (reads the hook JSON from stdin)

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const BIN = join(ROOT, 'node_modules', '.bin');

function isAppCode(filePath) {
  const rel = relative(ROOT, filePath).split(sep).join('/');
  return (rel.startsWith('src/') || rel.startsWith('test/')) && /\.(ts|vue)$/.test(rel);
}

function run(tool, args) {
  try {
    execFileSync(join(BIN, tool), args, { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' });
    return null;
  } catch (e) {
    return `${e.stdout ?? ''}${e.stderr ?? ''}`.trim() || String(e);
  }
}

async function hookMode() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const filePath = JSON.parse(input || '{}').tool_input?.file_path;
  if (!filePath || !existsSync(filePath) || !isAppCode(filePath)) return 0;
  if (!existsSync(join(BIN, 'prettier'))) return 0; // before `npm install`

  const prettierError = run('prettier', ['--write', filePath]);
  if (prettierError) {
    process.stderr.write(`code-format: prettier selhal (syntaktická chyba?):\n${prettierError}\n`);
    return 2;
  }
  const eslintError = run('eslint', ['--fix', filePath]);
  if (eslintError) {
    process.stderr.write(`code-format: ESLint hlásí chyby, které neumí opravit sám:\n${eslintError}\n`);
    return 2;
  }
  return 0;
}

process.exitCode = process.argv[2] === '--hook' ? await hookMode() : 0;
