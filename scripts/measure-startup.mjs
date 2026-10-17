#!/usr/bin/env node
// Measures the startup of the built app (M47, N125): bundle size of dist/ and the startup time in
// Chrome, the same scenario through the UI in the local (WASM) and in the server version, so the
// numbers before and after the native core series compare.
//
// Usage:
//   npm run measure -- --url http://localhost:4173 [--runs 5] [--dist dist] [--headed] [--label x]
//   npm run measure -- --dist dist --runs 0        (bundle only, no browser)
//
// The app must already run at --url: `npm run build && npx vite preview` for the local version,
// the same preview proxied to the Compose stack (docker compose up) for the server version. The
// script only drives a browser against the URL, it starts nothing.
//
// Scenario (UI the same in both versions), every run in a new browser with the HTTP cache off:
//   (a) startScreenMs   navigation → the start screen ("Nový" visible)
//   (b) newDocumentMs   click on "Nový" → the toolbar enabled ("Kvádr" enabled): usable viewport
//   (c) boxMs           OK of the box dialog with the defaults → the body shown ("Tělesa: 1")
//   (d) transferred     bytes over the network: `network` from the network events of the page
//                       and its workers (headers + encoded body), `resourceTiming` from Resource
//                       Timing of the page (transferSize; does not see the requests of workers)
// The output is JSON on stdout: the medians, all samples and the files of dist/ (raw and gzip).

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';
import { gzipSync } from 'node:zlib';
import { chromium } from '@playwright/test';

const { values: args } = parseArgs({
  options: {
    url: { type: 'string' },
    runs: { type: 'string', default: '5' },
    dist: { type: 'string' },
    headed: { type: 'boolean', default: false },
    label: { type: 'string' },
    timeout: { type: 'string', default: '120000' },
  },
});

const runs = Number(args.runs);
const timeout = Number(args.timeout);
if (!Number.isInteger(runs) || runs < 0) fail('--runs must be a whole number ≥ 0');
if (runs > 0 && args.url === undefined) fail('--url is required unless --runs 0');
if (runs === 0 && args.dist === undefined) fail('nothing to measure: give --url or --dist');

const result = {
  label: args.label ?? null,
  commit: gitCommit(args.dist ?? '.'),
  date: new Date().toISOString(),
  url: args.url ?? null,
  browser: { channel: 'chrome', headless: !args.headed },
  runs,
  median: null,
  samples: [],
  bundle: args.dist === undefined ? null : measureBundle(args.dist),
};

for (let i = 0; i < runs; i++) {
  const sample = await measureRun(args.url);
  result.samples.push(sample);
  process.stderr.write(`run ${String(i + 1)}/${String(runs)}: ${JSON.stringify(sample)}\n`);
}
if (runs > 0) {
  result.median = {
    startScreenMs: median(result.samples.map((s) => s.startScreenMs)),
    newDocumentMs: median(result.samples.map((s) => s.newDocumentMs)),
    boxMs: median(result.samples.map((s) => s.boxMs)),
    transferredBytes: {
      network: median(result.samples.map((s) => s.transferredBytes.network)),
      resourceTiming: median(result.samples.map((s) => s.transferredBytes.resourceTiming)),
    },
  };
}
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

/** One cold load: a new browser (no shared cache or compiled WASM), the cache off. */
async function measureRun(url) {
  const browser = await chromium.launch({ channel: 'chrome', headless: !args.headed });
  try {
    const context = await browser.newContext({
      locale: 'cs-CZ',
      viewport: { width: 1280, height: 800 },
    });
    context.setDefaultTimeout(timeout);
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });

    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    // Network events of Playwright include the requests of dedicated workers (OCCT, solver).
    const finished = [];
    context.on('requestfinished', (request) => finished.push(request));
    let failedRequests = 0;
    context.on('requestfailed', () => failedRequests++);

    const t0 = performance.now();
    await page.goto(url);
    const newButton = page.getByRole('button', { name: 'Nový', exact: true });
    await newButton.waitFor({ state: 'visible' });
    const t1 = performance.now();

    await newButton.click();
    const box = page.getByRole('button', { name: 'Kvádr', exact: true });
    await waitUntil(() => box.isEnabled());
    const t2 = performance.now();

    await box.click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor({ state: 'visible' });
    const ok = dialog.getByRole('button', { name: 'OK', exact: true });
    const t3 = performance.now();
    await ok.click();
    await page.getByText('Tělesa: 1', { exact: true }).waitFor({ state: 'visible' });
    const t4 = performance.now();

    const resourceTiming = await page.evaluate(() =>
      performance
        .getEntriesByType('navigation')
        .concat(performance.getEntriesByType('resource'))
        .reduce((sum, entry) => sum + entry.transferSize, 0),
    );
    let network = 0;
    for (const request of finished) {
      const sizes = await request.sizes();
      network += sizes.responseHeadersSize + sizes.responseBodySize;
    }

    return {
      startScreenMs: round(t1 - t0),
      newDocumentMs: round(t2 - t1),
      boxMs: round(t4 - t3),
      transferredBytes: { network, resourceTiming },
      requests: finished.length,
      failedRequests,
      errors,
    };
  } finally {
    await browser.close();
  }
}

/** Polls `check` every 10 ms (Playwright has no wait for "enabled" on a locator). */
async function waitUntil(check) {
  const deadline = performance.now() + timeout;
  while (!(await check().catch(() => false))) {
    if (performance.now() > deadline) throw new Error(`timed out after ${String(timeout)} ms`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** Every file under `dir`: raw and gzip (level 9) bytes, summed by kind. */
function measureBundle(dir) {
  const files = listFiles(dir).map((path) => {
    const content = readFileSync(path);
    return {
      file: relative(dir, path),
      kind: kindOf(path),
      raw: content.length,
      gzip: gzipSync(content, { level: 9 }).length,
    };
  });
  files.sort((a, b) => b.raw - a.raw);
  const byKind = {};
  for (const { kind, raw, gzip } of files) {
    const sum = (byKind[kind] ??= { files: 0, raw: 0, gzip: 0 });
    sum.files++;
    sum.raw += raw;
    sum.gzip += gzip;
  }
  const total = files.reduce((sum, f) => ({ raw: sum.raw + f.raw, gzip: sum.gzip + f.gzip }), {
    raw: 0,
    gzip: 0,
  });
  return { dir, total, byKind, files };
}

function listFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

function kindOf(path) {
  const ext = extname(path).toLowerCase();
  if (ext === '.js' || ext === '.mjs') return 'js';
  if (ext === '.wasm') return 'wasm';
  if (ext === '.css') return 'css';
  if (ext === '.html') return 'html';
  if (['.woff', '.woff2', '.ttf', '.otf', '.eot'].includes(ext)) return 'font';
  if (['.svg', '.png', '.ico', '.jpg', '.webp'].includes(ext)) return 'image';
  return 'other';
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : round((sorted[mid - 1] + sorted[mid]) / 2);
}

function round(ms) {
  return Math.round(ms * 10) / 10;
}

/** The commit of the measured checkout: the one holding --dist, else the current directory. */
function gitCommit(dir) {
  try {
    return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function fail(message) {
  process.stderr.write(`measure-startup: ${message}\n`);
  process.exit(2);
}
