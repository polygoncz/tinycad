---
type: concept
aliases:
  - GeometryKernel
  - kernel
  - OCCT
code: "GeometryKernel"
module: "kernel"
summary: "Port na geometrické operace; implementace OCCT ve WASM a FakeKernel."
related:
  - "[[Handle tvaru]]"
  - "[[Port a adaptér]]"
tags:
  - pojem
created: 2026-10-12
updated: 2026-10-12
---
# Geometrické jádro

[[Port a adaptér|Port]] (rozhraní) na B-rep operace: primitiva, booleany, sweep, fillet, tessellace. Asynchronní a segregované podle schopností. Implementace: `OcctKernelClient` (OpenCascade ve WASM ve Web Workeru) a `FakeKernel` pro testy.

**V návrhu:** [[06-geometricke-jadro]], [[0002-occt-wasm-ve-workeru]]
**Souvisí:** [[Handle tvaru]], [[Port a adaptér]]
