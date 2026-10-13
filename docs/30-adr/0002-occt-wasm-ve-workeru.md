---
type: adr
status: accepted
number: 2
aliases:
  - ADR 0002
  - OpenCascade ve WASM, ve Web Workeru, za portem
date: 2026-10-12
related:
  - "[[06-geometricke-jadro]]"
  - "[[02-core]]"
supersedes: 
tags:
  - adr
created: 2026-10-12
updated: 2026-10-12
---
# 0002 – OpenCascade ve WASM, ve Web Workeru, za portem

- **Stav:** Přijato (`status: accepted`)
- **Datum:** 2026-10-12
- **Souvisí:** [[06-geometricke-jadro]], [[02-core]]

## Kontext

Parametrický CAD potřebuje přesné B-rep jádro (fillety, booleany, STEP). Komerční jádra (Parasolid, ACIS, C3D) nejsou pro osobní projekt dostupná – licence se sjednávají individuálně a ve webu se typicky provozují na serveru. Open-source alternativy jsou buď nezralé (Truck, Fornjot), nebo pracují nad sítí trojúhelníků (Manifold), takže neumí přesné fillety ani pojem plochy. Pavel OCCT zná z práce.

Výpočty jádra trvají desítky až stovky milisekund. Na hlavním vlákně by zamrzalo UI.

## Rozhodnutí

- Geometrické jádro je OpenCascade zkompilovaný do WebAssembly.
- Běží ve vlastním Web Workeru. Tvary nikdy neopouštějí worker, ven jdou jen číselné handle a sítě jako transferable buffery.
- Doména zná jen port `GeometryKernel` (asynchronní, segregovaný podle schopností). Konkrétní adaptér `OcctKernelClient` vytváří jen `app`.
- Komunikace s workerem přes vlastní malou typovanou RPC vrstvu v `core/rpc` (ne Comlink) – je to krátké a výukové.
- Konkrétní WASM build (předpřipravený `opencascade.js`, `replicad-opencascadejs`, nebo vlastní C++ modul přes Emscripten) se vybere spikem na začátku M7.

## Zvažované alternativy

- **Jádro na serveru** (jako Onshape s Parasolidem) – zajímavá architektura, ale vyžaduje backend. Díky portu ji lze později přidat jako jiný adaptér.
- **Jádro na hlavním vlákně** – jednodušší, ale blokuje UI.
- **Truck (Rust)** – čistší návrh, ale slabé fillety a booleany.
- **Comlink** – hotové RPC, ale skrývá mechanismus, který se chceme naučit.

## Důsledky

- + UI zůstává plynulé i při pomalé operaci.
- + Jádro jde vyměnit, testy vyšších vrstev běží s `FakeKernel`.
- − Asynchronní API všude, kde se pracuje s geometrií.
- − Ruční správa životnosti handle (řeší mark & sweep v `regen`).
- − Velký WASM soubor (desítky MB) – pomalý první start.
