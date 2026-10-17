---
type: milestone
status: doing
order: 39
aliases:
  - M39
  - M39 Kostra serveru a GeometryService
modules:
  - server
  - app
  - sketcher
specs:
  - "[[14-protokol]]"
  - "[[12-skicar]]"
depends_on:
  - "[[M38-zmrazeni-domeny]]"
started: 2026-10-17
finished:
tags:
  - milnik
created: 2026-10-17
updated: 2026-10-17
---
# M39 – Kostra serveru a GeometryService

**Cíl:** Složka `server/` se sestaví v Dockeru, Envoy překládá gRPC-Web a skicář volá 2D geometrii přes `GeometryService` místo WASM – první svislý řez celým stackem.

> Hrubý plán série nativního jádra (2026-10-17). Před zahájením upřesnit úkoly, kontrakt a Implementační plán.

**Specifikace:** [[14-protokol]], [[12-skicar]], [[0030-nativni-jadro-pres-grpc|ADR 0030]]

**Navazuje na:** [[M38-zmrazeni-domeny]]

## Úkoly

- [ ] Moduly `protocol` a `remote` podle [[Q106 Moduly klienta pro gRPC|Q106]]: propsat do [[01-architektura]] a `.dependency-cruiser.cjs`, `src/protocol/` do `.gitignore`, skript `gen:proto` před `typecheck`, `dev` a `build`.
- [ ] `server/`: `CMakeLists.txt`, `CMakePresets.json`, `vcpkg.json` s připnutou baseline (grpc, protobuf, opencascade, sqlite3, gtest, nlohmann-json a závislosti planegcs – Eigen, případně Boost – aby souběžné stopy po M39 baseline neměnily). Baseline je nejnovější registr vcpkg a OCCT je verze, kterou nabízí (dnes 8.0.1), bez overlay portu a `overrides`. Zapsat skutečnou verzi do [[06-geometricke-jadro]] ([[Q104 Nástroje pro kontrakt a C++ server|Q104]]).
- [ ] `buf generate`: C++ do buildu serveru, TS (protobuf-es) do `src/protocol/`. `npm run check` dostane `check:proto` (`buf lint`, `buf breaking` proti `main`).
- [ ] `docker-compose.yml`: `core` (vícestupňový Dockerfile, binární cache vcpkg ve volume) a `envoy` (filtr `grpc_web`, CORS pro `localhost:5173`, health check). Vite proxy `/api` na Envoy.
- [ ] `GeometryService` v C++ nad OCCT (`Geom2dAPI_InterCurveCurve`, segment, zaoblení, offset) proti sdíleným případům z M38.
- [ ] Adaptér `SketchGeometry` v `remote/` s jedním požadavkem v letu na metodu ([[Q096 Geometrie skici přes síť|Q096]]); `app` ho použije místo WASM.
- [ ] `npm run check` dostane `check:server` (build a GoogleTest v Dockeru); e2e trim/offset proti Docker Compose.

## Akceptační kritéria

- `docker compose up` spustí jádro a Envoy jedním příkazem, build je reprodukovatelný.
- Trim, extend, split, zaoblení a offset ve skicáři fungují přes server, e2e zelené.
- Sdílené případy 2D geometrie projdou v C++.

## Implementační plán

Samostatný běh ([[Rozhodnutí nativního jádra]]). Dvě souběžné části ve vlastních worktree, sloučené hlavním sezením:

### S. Server (`server/`, `docker-compose.yml`, `envoy/`)

- **Soubory:** `server/CMakeLists.txt`, `CMakePresets.json`, `vcpkg.json` (baseline = nejnovější registr; grpc, protobuf, opencascade, nlohmann-json, gtest, sqlite3, eigen3 a boost pro planegcs), `server/Dockerfile` (vícestupňový: `deps` s vcpkg a binární cache, `build`, `runtime`), `server/src/geometry/` (knihovna 2D geometrie nad OCCT – přepis `src/kernel-occt` funkcí `curveIntersections`, `curveSegment`, `filletArc`, `offsetCurves` včetně kontrol vstupu a kódů chyb), `server/src/service/` (`GeometryService` přes gRPC, převod `Curve2` ↔ proto), `server/src/main.cpp`, `server/test/` (GoogleTest: spouštěč sdílených případů `geometry.*` nad `test/shared-cases/geometry/` se stejným porovnáním jako spec 13), `docker-compose.yml` (`core`, `envoy`; pojmenovaný sdílený svazek `tinycad-vcpkg-cache`), `envoy/envoy.yaml` (`grpc_web`, CORS pro `localhost:5173`, health check), `scripts/check-server.mjs` (build a GoogleTest v Dockeru).
- **Hotovo když:** `docker compose up` spustí jádro a Envoy, 86 případů `geometry.*` zelených v C++, `grpcurl`/test volání přes Envoy funguje.

### C. Klient (`src/protocol`, `src/remote`, nástroje)

- **Soubory:** `buf.gen.yaml` (protobuf-es do `src/protocol/`, ne v gitu), `package.json` (`@bufbuild/buf`, `@bufbuild/protobuf`, `@bufbuild/protoc-gen-es`, `@connectrpc/connect`, `@connectrpc/connect-web`; skripty `gen:proto` před `typecheck`/`dev`/`build`/`test`, `check:proto` = `buf lint` + `buf breaking` proti `main`, `check:server`), `.gitignore`, `.dependency-cruiser.cjs` a [[01-architektura]] (moduly `protocol`, `remote` podle [[Q106 Moduly klienta pro gRPC|Q106]]), `src/remote/` (adaptér `SketchGeometry` nad `GeometryService` s jedním požadavkem v letu na metodu, převod `Curve2`, chyby → `KernelErrorCode`), `src/app` (volba adaptéru podle `VITE_CORE_URL`), `vite.config.ts` (proxy `/api` na Envoy).
- **Testy:** adaptér proti falešnému transportu (jeden v letu, poslední vyhrává, chyby), převody tam a zpět.
- **Hotovo když:** cílené testy zelené; celý `npm run check` při sloučení.

### Společně (hlavní sezení)

- E2E `test/e2e/m39.spec.ts` (trim a offset přes server) běží jen s `E2E_CORE=1` a spuštěným Compose.

## Co se naučíš

CMake s vcpkg, generování kódu z `.proto` pro dva jazyky, Envoy a gRPC-Web, první gRPC služba v C++.

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Retrospektiva

_(vyplnit po dokončení; obecné poznatky přesunout do `70-poznatky/`)_
