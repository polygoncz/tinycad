#!/usr/bin/env node
// Lints the Obsidian vault in docs/ against docs/00-meta/Konvence vaultu.md:
// required frontmatter per note type, allowed status values, date formats and
// wikilinks that point to existing notes.
//
// Usage:
//   node scripts/vault-lint.mjs            lint the whole vault
//   node scripts/vault-lint.mjs <file>...  lint selected notes
//   node scripts/vault-lint.mjs --hook     Claude Code PostToolUse hook: reads the hook
//                                          JSON from stdin, bumps `updated` of the edited
//                                          note to today and lints it (exit 2 = report to Claude)
//
// No dependencies on purpose: it has to run before `npm install` exists (M0).

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative, resolve, basename, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const VAULT = join(ROOT, 'docs');
const TEMPLATES = join(VAULT, '00-meta', 'sablony');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_KEYS = ['created', 'updated', 'date', 'started', 'finished'];
const COMMON = ['type', 'tags', 'created', 'updated'];

// Mirrors the property table in "Konvence vaultu".
const SCHEMA = {
  spec: { keys: ['order', 'modules', 'milestones'], status: ['outline', 'draft', 'accepted', 'implemented'] },
  adr: { keys: ['number', 'date', 'related', 'supersedes'], status: ['proposed', 'accepted', 'superseded'] },
  milestone: {
    keys: ['order', 'modules', 'specs', 'depends_on', 'started', 'finished'],
    status: ['todo', 'doing', 'done'],
  },
  concept: { keys: ['code', 'module', 'summary', 'related'] },
  question: { keys: ['area', 'decide_by', 'proposal', 'decision'], status: ['open', 'answered', 'dropped'] },
  insight: { keys: ['topics', 'sources'], status: ['seed', 'evergreen'] },
  log: { keys: ['date', 'summary', 'milestones'] },
  moc: { keys: [], status: ['active'] },
  meta: { keys: [], status: ['active'] },
  note: { keys: [], common: ['type'] },
};

const nfc = (s) => s.normalize('NFC');
const today = () => new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD in local time

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue; // .obsidian, .gitkeep, .DS_Store
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** Minimal YAML subset used by the vault: `key: value` and `key:` + `  - item` lists. */
function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!m) return null;
  const fm = {};
  let listKey = null;
  for (const line of m[1].split(/\r?\n/)) {
    const item = /^\s+-\s*(.*)$/.exec(line);
    if (item && listKey) {
      fm[listKey].push(unquote(item[1]));
      continue;
    }
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const [, key, raw] = kv;
    if (raw === '') {
      fm[key] = [];
      listKey = key;
    } else {
      fm[key] = raw === '[]' ? [] : unquote(raw);
      listKey = null;
    }
  }
  return fm;
}

const unquote = (v) => v.trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
const isEmpty = (v) => v === undefined || v === '' || (Array.isArray(v) && v.length === 0);

/** Wikilink targets outside code blocks and inline code. */
function wikilinks(text) {
  const body = text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  const out = [];
  for (const m of body.matchAll(/!?\[\[([^\]\n]+?)\]\]/g)) {
    const target = m[1].split(/\\?\|/)[0].split('#')[0].trim();
    if (target) out.push(target);
  }
  return out;
}

function buildIndex() {
  const names = new Set();
  for (const f of walk(VAULT)) {
    const rel = nfc(relative(VAULT, f).split(sep).join('/'));
    const name = nfc(basename(f));
    names.add(name).add(rel);
    if (extname(f) === '.md') names.add(name.slice(0, -3)).add(rel.slice(0, -3));
  }
  return names;
}

function lintFile(file, index) {
  const errors = [];
  const text = readFileSync(file, 'utf8');
  const fm = parseFrontmatter(text);
  if (!fm) return ['chybí frontmatter (--- … ---)'];

  const type = fm.type;
  const schema = SCHEMA[type];
  if (!schema) return [`neznámý type: "${type ?? ''}" (povolené: ${Object.keys(SCHEMA).join(', ')})`];

  for (const key of [...(schema.common ?? COMMON), ...schema.keys]) {
    if (!(key in fm)) errors.push(`chybí vlastnost \`${key}\``);
  }
  if (schema.status && !schema.status.includes(fm.status)) {
    errors.push(`status "${fm.status ?? ''}" není povolený pro ${type} (${schema.status.join(' | ')})`);
  }
  for (const key of DATE_KEYS) {
    const v = fm[key];
    if (!isEmpty(v) && !DATE_RE.test(v)) errors.push(`\`${key}\` není ve formátu RRRR-MM-DD: "${v}"`);
  }
  if (type === 'milestone' && fm.status !== 'todo' && isEmpty(fm.started)) errors.push('milník není `todo`, ale chybí `started`');
  if (type === 'milestone' && fm.status === 'done' && isEmpty(fm.finished)) errors.push('milník je `done`, ale chybí `finished`');
  if (type === 'question' && fm.status === 'answered' && isEmpty(fm.decision)) errors.push('otázka je `answered`, ale chybí `decision`');

  for (const target of wikilinks(text)) {
    if (!index.has(nfc(target))) errors.push(`rozbitý odkaz [[${target}]]`);
  }
  return errors;
}

function isLintable(file) {
  const abs = resolve(file);
  return abs.startsWith(VAULT + sep) && extname(abs) === '.md' && !abs.startsWith(TEMPLATES + sep) && !abs.includes(`${sep}.obsidian${sep}`);
}

/** Sets `updated:` to today; returns true when the file changed. */
function bumpUpdated(file) {
  const text = readFileSync(file, 'utf8');
  const fmEnd = text.indexOf('\n---', 3);
  if (!text.startsWith('---') || fmEnd < 0) return false;
  const head = text.slice(0, fmEnd);
  const next = head.replace(/^updated:.*$/m, `updated: ${today()}`);
  if (next === head) return false;
  writeFileSync(file, next + text.slice(fmEnd));
  return true;
}

function report(results) {
  const lines = [];
  for (const [file, errors] of results) {
    if (errors.length === 0) continue;
    lines.push(`${relative(ROOT, file)}:`);
    for (const e of errors) lines.push(`  - ${e}`);
  }
  return lines.join('\n');
}

async function hookMode() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const filePath = JSON.parse(input || '{}').tool_input?.file_path;
  if (!filePath || !existsSync(filePath) || !isLintable(filePath)) return 0;

  const bumped = bumpUpdated(filePath);
  const errors = lintFile(filePath, buildIndex());
  if (errors.length > 0) {
    process.stderr.write(`vault-lint: poznámka porušuje Konvence vaultu, oprav ji:\n${report([[filePath, errors]])}\n`);
    return 2;
  }
  if (bumped) process.stdout.write(`vault-lint: \`updated\` nastaveno na ${today()} (${relative(ROOT, filePath)})\n`);
  return 0;
}

function cliMode(args) {
  const files = (args.length > 0 ? args.map((a) => resolve(a)) : walk(VAULT)).filter(isLintable);
  const index = buildIndex();
  const results = files.map((f) => [f, lintFile(f, index)]);
  const out = report(results);
  if (out) {
    console.error(out);
    console.error(`\nvault-lint: ${results.filter(([, e]) => e.length).length} poznámek s chybami z ${files.length}`);
    return 1;
  }
  console.log(`vault-lint: OK (${files.length} poznámek)`);
  return 0;
}

const args = process.argv.slice(2);
process.exitCode = args[0] === '--hook' ? await hookMode() : cliMode(args);
