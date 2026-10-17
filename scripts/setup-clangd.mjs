#!/usr/bin/env node
// npm run setup:clangd: prepares code navigation of the native core (server/) for clangd on the
// host, without installing OCCT, gRPC or a C++ toolchain there (ADR 0030, decision N1).
//
// The dependencies exist only in the Docker image (stage `deps` of server/Dockerfile), so this
// script, inside a container of that image:
//   1. configures server/ into server/build/clangd (CMAKE_EXPORT_COMPILE_COMMANDS is on),
//   2. builds tinycad_proto, so the generated *.pb.h headers exist,
//   3. copies the vcpkg headers to server/build/clangd/vcpkg_include.
// Then, on the host, it rewrites the container paths in compile_commands.json to host paths.
// server/.clangd points clangd at that database. Works on macOS, Linux and Windows: the
// container sees the repository at /src, never at the host path. The standard library comes
// from the host compiler, which is enough for navigation and diagnostics.
//
// Rerun after adding a source file or changing a CMakeLists.txt or vcpkg.json.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const BUILD_DIR = 'server/build/clangd';
const IMAGE = 'tinycad-core:deps';
const CONTAINER_ROOT = '/src';
const CONTAINER_INSTALLED = '/opt/vcpkg_installed';

function run(args) {
  const result = spawnSync('docker', args, {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, DOCKER_BUILDKIT: '1' },
  });
  if (result.error) {
    process.stderr.write(`setup-clangd: cannot run docker: ${result.error.message}\n`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// Forward slashes on every platform: clangd accepts them on Windows too.
function hostPath(relative) {
  return resolve(ROOT, relative).replaceAll('\\', '/');
}

// 1. The image with the dependencies (cached after the first npm run check:server).
run(['build', '--target', 'deps', '--file', 'server/Dockerfile', '--tag', IMAGE, '.']);

// 2. Configure, generate and copy the headers inside the container.
const script = [
  'set -e',
  'T=$(cat /opt/vcpkg-triplet)',
  `cmake -S server -B ${BUILD_DIR} -G Ninja` +
    ' -DCMAKE_TOOLCHAIN_FILE=$VCPKG_ROOT/scripts/buildsystems/vcpkg.cmake' +
    ` -DVCPKG_MANIFEST_INSTALL=OFF -DVCPKG_INSTALLED_DIR=${CONTAINER_INSTALLED}` +
    ' -DVCPKG_TARGET_TRIPLET=$T -DVCPKG_HOST_TRIPLET=$T -DCMAKE_BUILD_TYPE=Release',
  `cmake --build ${BUILD_DIR} --target tinycad_proto --parallel 3`,
  `rm -rf ${BUILD_DIR}/vcpkg_include`,
  `cp -r ${CONTAINER_INSTALLED}/$T/include ${BUILD_DIR}/vcpkg_include`,
  `echo $T > ${BUILD_DIR}/vcpkg_triplet`,
].join('\n');

// On Linux the files would belong to root without --user; Docker Desktop maps them itself.
const user =
  typeof process.getuid === 'function' ? ['--user', `${process.getuid()}:${process.getgid()}`] : [];
run([
  'run',
  '--rm',
  ...user,
  '--env',
  'HOME=/tmp',
  '--volume',
  `${ROOT}:${CONTAINER_ROOT}`,
  '--workdir',
  CONTAINER_ROOT,
  IMAGE,
  'sh',
  '-c',
  script,
]);

// 3. Container paths -> host paths. /src only where a path starts (after a quote, a space or
// -I), so /src inside another path stays; the vcpkg headers second, as they lie outside /src.
const database = resolve(ROOT, BUILD_DIR, 'compile_commands.json');
if (!existsSync(database)) {
  process.stderr.write(`setup-clangd: ${database} was not generated\n`);
  process.exit(1);
}
const triplet = readFileSync(resolve(ROOT, BUILD_DIR, 'vcpkg_triplet'), 'utf8').trim();
const rewritten = readFileSync(database, 'utf8')
  .replace(new RegExp(`(?<=["\\s]|-I)${CONTAINER_ROOT}(?=[/"])`, 'g'), hostPath('.'))
  .replaceAll(`${CONTAINER_INSTALLED}/${triplet}/include`, hostPath(`${BUILD_DIR}/vcpkg_include`));
writeFileSync(database, rewritten);

process.stdout.write(`setup-clangd: ${hostPath(BUILD_DIR)}/compile_commands.json is ready\n`);
