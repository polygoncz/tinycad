# syntax=docker/dockerfile:1.7
#
# tinycad native core (ADR 0030). Build context is the repository root
# (see .dockerignore): the image needs server/, test/shared-cases/ and test/golden/.
#
#   deps    – toolchain, vcpkg at a pinned commit, all C++ dependencies
#   build   – configure, build and run the GoogleTest suite (ctest)
#   runtime – slim image with the statically linked tinycad-core binary
#
# vcpkg binary packages and downloads live in BuildKit cache mounts with a
# fixed id, so every worktree on the same Docker daemon reuses them.

ARG UBUNTU_VERSION=24.04

FROM ubuntu:${UBUNTU_VERSION} AS deps

# Same commit as "builtin-baseline" in server/vcpkg.json.
ARG VCPKG_COMMIT=a5f736224e85b32e25a8ffc52562333180396642
# Parallel compile jobs; ~6 keeps OCCT and gRPC within 8 GB of RAM.
ARG VCPKG_MAX_CONCURRENCY=6
ARG TARGETARCH

ENV DEBIAN_FRONTEND=noninteractive

# Toolchain. The X11/GL headers are only needed to build the OCCT
# visualization toolkits that the vcpkg port always builds; tinycad-core
# links modeling toolkits only, so the runtime image does not need them.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      build-essential cmake ninja-build pkg-config git curl ca-certificates \
      zip unzip tar python3 autoconf automake autoconf-archive libtool bison flex \
      linux-libc-dev libx11-dev libxext-dev libxi-dev libxrandr-dev libxcursor-dev \
      libxinerama-dev libgl-dev libglu1-mesa-dev libegl-dev \
 && rm -rf /var/lib/apt/lists/*

ENV VCPKG_ROOT=/opt/vcpkg \
    VCPKG_FORCE_SYSTEM_BINARIES=1 \
    VCPKG_DISABLE_METRICS=1 \
    VCPKG_MAX_CONCURRENCY=${VCPKG_MAX_CONCURRENCY} \
    VCPKG_DOWNLOADS=/var/cache/vcpkg/downloads \
    VCPKG_BINARY_SOURCES="clear;files,/var/cache/vcpkg/archives,readwrite"

# The cache folders exist in the image too (bootstrap checks VCPKG_DOWNLOADS);
# the install step mounts the shared cache over them.
RUN mkdir -p /var/cache/vcpkg/downloads /var/cache/vcpkg/archives \
 && git init -q ${VCPKG_ROOT} \
 && git -C ${VCPKG_ROOT} remote add origin https://github.com/microsoft/vcpkg.git \
 && git -C ${VCPKG_ROOT} fetch -q --depth 1 origin ${VCPKG_COMMIT} \
 && git -C ${VCPKG_ROOT} checkout -q FETCH_HEAD \
 && ${VCPKG_ROOT}/bootstrap-vcpkg.sh -disableMetrics

# Release-only community triplet: half the build time, no debug libraries.
RUN case "${TARGETARCH:-arm64}" in \
      arm64) echo arm64-linux-release ;; \
      amd64) echo x64-linux-release ;; \
      *) echo "unsupported architecture ${TARGETARCH}" >&2; exit 1 ;; \
    esac > /opt/vcpkg-triplet

WORKDIR /src/server
COPY server/vcpkg.json ./
RUN --mount=type=cache,id=tinycad-vcpkg-cache,target=/var/cache/vcpkg \
    mkdir -p /var/cache/vcpkg/downloads /var/cache/vcpkg/archives \
 && ${VCPKG_ROOT}/vcpkg install \
      --triplet "$(cat /opt/vcpkg-triplet)" \
      --host-triplet "$(cat /opt/vcpkg-triplet)" \
      --x-install-root=/opt/vcpkg_installed \
      --clean-after-build \
 || (find ${VCPKG_ROOT}/buildtrees -name '*-err.log' -newer /opt/vcpkg-triplet \
       -exec sh -c 'echo "=== $1"; tail -n 60 "$1"' _ {} \; ; exit 1)

FROM deps AS build

COPY server/ /src/server/
COPY test/shared-cases/ /src/test/shared-cases/
COPY test/golden/ /src/test/golden/

RUN cmake --preset docker \
      -DVCPKG_TARGET_TRIPLET="$(cat /opt/vcpkg-triplet)" \
      -DVCPKG_HOST_TRIPLET="$(cat /opt/vcpkg-triplet)" \
 && cmake --build --preset docker \
 && ctest --preset docker

FROM ubuntu:${UBUNTU_VERSION} AS runtime

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --no-create-home tinycad

COPY --from=build /src/server/build/docker/src/app/tinycad-core /usr/local/bin/tinycad-core
# One-off import of documents exported from the browser (M41, decision N38):
#   docker compose run --rm --entrypoint tinycad-import -v ~/tinycad-export:/import core /import
COPY --from=build /src/server/build/docker/src/tools/tinycad-import /usr/local/bin/tinycad-import

USER tinycad
EXPOSE 50051
ENTRYPOINT ["/usr/local/bin/tinycad-core"]
