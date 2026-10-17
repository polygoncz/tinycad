#!/usr/bin/env node
// The native core of the e2e tests (M46, decision N72): `node scripts/e2e-core.mjs up` builds and
// starts docker-compose.e2e.yml as the Compose project tinycad-e2e-<E2E_PORT> and waits until
// Envoy is ready; `down` removes it with its tmpfs data. playwright.config.ts calls both
// (test/e2e/global-setup.ts), so `npm run test:e2e` needs only a running Docker.
//   E2E_PORT       the port of `vite preview`, names the project (default 4173)
//   E2E_CORE_PORT  the port of Envoy on localhost (default 18080)

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');

/** The Compose project of this run: one per E2E_PORT, so parallel worktrees never meet. */
export function e2eProject() {
  return `tinycad-e2e-${process.env.E2E_PORT ?? '4173'}`;
}

function compose(args) {
  return spawnSync(
    'docker',
    ['compose', '--project-name', e2eProject(), '--file', 'docker-compose.e2e.yml', ...args],
    { cwd: ROOT, stdio: 'inherit', env: { ...process.env, DOCKER_BUILDKIT: '1' } },
  );
}

function fail(message) {
  process.stderr.write(`e2e-core: ${message}\n`);
  process.exit(1);
}

/** Builds the image of this checkout and starts the core and Envoy; resolves once Envoy is ready. */
export function up() {
  const info = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], {
    stdio: 'ignore',
  });
  if (info.error !== undefined || info.status !== 0) {
    fail('Docker is not running; the e2e tests need it (docker-compose.e2e.yml, N72)');
  }
  const result = compose(['up', '--detach', '--build', '--wait', '--force-recreate']);
  if (result.status !== 0) fail(`docker compose up failed (${e2eProject()})`);
}

/** Stops and removes the project; the tmpfs data goes with the container. */
export function down() {
  const result = compose(['down', '--volumes', '--remove-orphans']);
  if (result.status !== 0) fail(`docker compose down failed (${e2eProject()})`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  if (command === 'up') up();
  else if (command === 'down') down();
  else fail('usage: node scripts/e2e-core.mjs up|down');
}
