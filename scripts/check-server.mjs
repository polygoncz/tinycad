#!/usr/bin/env node
// npm run check:server: builds the stage `build` of server/Dockerfile, which configures and
// builds tinycad-core and runs its GoogleTest suite (ctest, the shared cases geometry.* too).
// The exit code is the result: a failing test fails the image build. Needs a running Docker;
// nothing is installed on the host (ADR 0030, decision N1). The first run builds the vcpkg
// dependencies (OCCT, gRPC) for tens of minutes; later runs reuse the Docker layer cache and the
// vcpkg binary cache (BuildKit cache mount tinycad-vcpkg-cache).

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');

const result = spawnSync(
  'docker',
  [
    'build',
    '--target',
    'build',
    '--file',
    'server/Dockerfile',
    '--tag',
    'tinycad-core:build',
    '--progress',
    'plain',
    // At most -j3 by default: parallel builds of several worktrees share 8 GB of RAM (N116).
    '--build-arg',
    `CMAKE_BUILD_PARALLEL_LEVEL=${process.env.CMAKE_BUILD_PARALLEL_LEVEL ?? '3'}`,
    '.',
  ],
  { cwd: ROOT, stdio: 'inherit', env: { ...process.env, DOCKER_BUILDKIT: '1' } },
);

if (result.error) {
  process.stderr.write(`check-server: cannot run docker: ${result.error.message}\n`);
  process.exit(1);
}
process.exit(result.status ?? 1);
