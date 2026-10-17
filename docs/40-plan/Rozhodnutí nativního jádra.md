---
type: moc
status: active
aliases:
  - Samostatný běh M39–M47
  - Rozhodnutí série nativního jádra
tags:
  - plan
created: 2026-10-17
updated: 2026-10-17
---
# Rozhodnutí nativního jádra

Pavel 2026-10-17: „zkus naimplementovat všechny milníky. Pokud budeš potřebovat něco rozhodnout, tak to rozhodni. Nakonec mi z toho připravíš prezentaci.“ Milníky [[M39-kostra-serveru|M39]]–[[M47-uklid-a-dokonceni|M47]] proto běží bez průběžného schvalování, stejným postupem jako [[Rozhodnutí noční rychloakce]]. **Tady je průběžný seznam všeho, co jsem rozhodl sám.** Podrobnosti jsou v odkazované otázce, ADR nebo specifikaci, tady je jedna věta a proč.

Postup: plán a kontrakty ve vaultu → úkoly přes `implementer` (po M39 tři souběžné stopy podle [[Roadmapa#Nativní jádro (M38–M47)]]) → kontrola proti spec a sdíleným případům z [[M38-zmrazeni-domeny|M38]] → `npm run check` → commit po milníku do větve, slučování do `main` po milnících. Nic se nepushuje.

Značka **⚠ k revizi** = rozhodnutí, u kterého si nejsem jistý nebo které zužuje rozsah.

## Shrnutí pro revizi

_(doplňuje se průběžně)_

## Obecné

- **N1 – Docker Desktop spuštěný z běhu.** Neběžel; build serveru a Envoy podle [[0030-nativni-jadro-pres-grpc|ADR 0030]] Docker potřebují. Na hostitele se nic neinstaluje (CMake, vcpkg, buf běží v kontejneru nebo přes npm).

- **N2 – Testy po větších celcích** (Pavel během běhu: „pracuj efektivně, paralelně, testuj spíše větší celky“). Implementátoři pouští jen cílené testy; celý `npm run check` při sloučení milníku nebo stopy, e2e na konci větších celků.

## M39 – Kostra serveru a GeometryService

- **N3 ⚠ – Aplikace volí adaptér `SketchGeometry` podle `VITE_CORE_URL`.** Se serverem jde 2D geometrie přes `GeometryService`, bez něj dál přes WASM. Proč: do [[M46-klient-nad-read-modelem|M46]] má aplikace běžet i bez Dockeru (Roadmapa: „až do té doby aplikace běží“) a stávající e2e nemají záviset na Compose. E2E přes server běží s `E2E_CORE=1`.
- **N4 – C++ kód z protobufu generuje CMake v kontejneru** (`protobuf_generate`, `grpc_cpp_plugin` z vcpkg), `buf generate` jen pro TS. Proč: verze `protoc` pro C++ musí sedět s knihovnou protobuf z vcpkg; přes buf by šlo o druhý zdroj pravdy.
- **N5 – Sdílený pojmenovaný svazek `tinycad-vcpkg-cache`** pro binární cache vcpkg napříč worktree. Proč: souběžné stopy by jinak každá překládaly OCCT a gRPC (desítky minut).
- **N6 ⚠ – Slučování požadavků `GeometryService` jen se stejným klíčem.** Jeden požadavek v letu na metodu zůstává, ale „poslední vyhrává“ jen mezi čekajícími voláními se stejným klíčem: `intersections` podle množiny id křivek, `offset` podle id řetězce a `closed`; `segment` a `fillet` se neslučují (fronta). Proč: implementátor M39 našel, že slučování podle spec 14 by nástrojům trim, split, zkosení a extend podstrčilo výsledek cizího volání (souběžné `segment`, `intersections` nástroje vedle bodů křížení celé skici). Spec 14 upravená.
- **N7 – `remote` smí záviset na `kernel`** (`createKernelError`, `KernelErrorCode`), aby chyby přes síť vypadaly jako z WASM jádra. Doplněno k [[Q106 Moduly klienta pro gRPC|Q106]] a do [[01-architektura]].
- **N8 – Vygenerovaný modul `src/protocol` má i vygenerovaný `index.ts`** (`scripts/gen-proto.mjs`), takže se do něj neimportuje hluboko; `gen:proto` běží jako pre-skript a snese souběžné spuštění v `run-p`.
