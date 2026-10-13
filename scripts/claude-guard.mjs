#!/usr/bin/env node
// Claude Code PreToolUse hook enforcing two vault rules from docs/00-meta/Konvence vaultu.md:
//   - nothing in docs/ is deleted (archive to docs/90-archiv/ instead),
//   - Pavel's notes in docs/01-inbox/ are not rewritten (new files are fine).
// Exit 2 blocks the tool call and shows stderr to Claude. It is a guardrail, not a sandbox:
// it judges the delete targets of a Bash command, not the shell's working directory, so
// deleting a scratch file outside the vault is never blocked just because the shell sits in docs/.

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

/** Splits a command line into simple commands (on ; && || | & and newlines), outside quotes. */
function simpleCommands(cmd) {
  const parts = [];
  let current = '';
  let quote = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (quote) {
      if (c === quote) quote = null;
      current += c;
    } else if (c === "'" || c === '"') {
      quote = c;
      current += c;
    } else if (c === ';' || c === '\n' || c === '|' || c === '&') {
      parts.push(current);
      current = '';
    } else {
      current += c;
    }
  }
  parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** Shell-like words of a simple command: quotes removed, a leading `(` dropped. */
function words(command) {
  return (command.replace(/^[({]\s*/, '').match(/'[^']*'|"[^"]*"|\S+/g) ?? []).map((w) =>
    w.replace(/^(['"])(.*)\1$/, '$2'),
  );
}

/** Does deleting `arg` (relative to `dir`) touch the vault? A target inside it, or one containing it. */
function hitsVault(arg, dir) {
  const home = process.env.HOME ?? '';
  const expanded = arg.replace(/^~(?=\/|$)/, home);
  // Unknown parts (variables, globs, substitutions): judge by the static prefix before them.
  const dynamic = expanded.search(/[$`*?[{]/);
  const staticPart = dynamic === -1 ? expanded : expanded.slice(0, dynamic);
  const target = resolve(dir, staticPart || '.');
  if (dynamic === -1) return inside(target, VAULT) || inside(VAULT, target);
  // `rm "$X"` alone cannot be judged: block only if the prefix could reach the vault.
  return inside(target, VAULT) || inside(VAULT, target) || /(^|\/)docs(\/|$)/.test(expanded);
}

const DELETERS = new Set(['rm', 'rmdir', 'unlink', 'trash']);

/** Delete targets of a Bash command that touch the vault, following `cd` between commands. */
function vaultDeletes(cmd, cwd) {
  let dir = cwd;
  const hits = [];
  for (const command of simpleCommands(cmd)) {
    let w = words(command);
    while (w[0] === 'sudo' || w[0] === 'command' || /^\w+=/.test(w[0] ?? '')) w = w.slice(1);
    if (w[0] === 'cd') {
      // `cd` without an argument goes home; `cd -` is unknown, keep the current guess.
      if (w[1] === undefined) dir = process.env.HOME ?? dir;
      else if (w[1] !== '-') dir = resolve(dir, w[1].replace(/^~(?=\/|$)/, process.env.HOME ?? ''));
      continue;
    }
    let args;
    if (w[0] !== undefined && DELETERS.has(w[0])) args = w.slice(1);
    else if (w[0] === 'git' && w[1] === 'rm') args = w.slice(2);
    else continue;
    let options = true;
    for (const a of args) {
      if (options && a === '--') {
        options = false;
        continue;
      }
      if (options && a.startsWith('-')) continue;
      if (hitsVault(a, dir)) hits.push(a);
    }
  }
  return hits;
}

let input = '';
for await (const chunk of process.stdin) input += chunk;
const { tool_name: tool, tool_input: args = {}, cwd = ROOT } = JSON.parse(input || '{}');

if (tool === 'Bash') {
  const hits = vaultDeletes(String(args.command ?? ''), resolve(cwd));
  if (hits.length > 0) {
    block(
      `ve vaultu docs/ se nic nemaže (${hits.join(', ')}). Nepotřebnou poznámku přesuň do docs/90-archiv/ (Konvence vaultu, pravidlo 9).`,
    );
  }
}

if (tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit') {
  const file = resolve(cwd, String(args.file_path ?? ''));
  if (inside(file, INBOX) && existsSync(file)) {
    block('poznámky v docs/01-inbox/ jsou Pavlovy a nepřepisují se. Navrhni změnu v chatu nebo poznámku zpracuj do správné složky (Konvence vaultu, pravidlo 7).');
  }
}
