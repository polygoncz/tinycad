---
type: milestone
status: todo
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
started:
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
- [ ] `server/`: `CMakeLists.txt`, `CMakePresets.json`, `vcpkg.json` s připnutou baseline (grpc, protobuf, opencascade 8.0.1 přes `overrides`, sqlite3, gtest, nlohmann-json); když baseline 8.0.1 nemá, overlay port ze značky `V8_0_1` ([[Q104 Nástroje pro kontrakt a C++ server|Q104]]).
- [ ] `buf generate`: C++ do buildu serveru, TS (protobuf-es) do `src/protocol/`. `npm run check` dostane `check:proto` (`buf lint`, `buf breaking` proti `main`).
- [ ] `docker-compose.yml`: `core` (vícestupňový Dockerfile, binární cache vcpkg ve volume) a `envoy` (filtr `grpc_web`, CORS pro `localhost:5173`, health check). Vite proxy `/api` na Envoy.
- [ ] `GeometryService` v C++ nad OCCT 8.0.1 (`Geom2dAPI_InterCurveCurve`, segment, zaoblení, offset) proti sdíleným případům z M38.
- [ ] Adaptér `SketchGeometry` v `remote/` s jedním požadavkem v letu na metodu ([[Q096 Geometrie skici přes síť|Q096]]); `app` ho použije místo WASM.
- [ ] `npm run check` dostane `check:server` (build a GoogleTest v Dockeru); e2e trim/offset proti Docker Compose.

## Akceptační kritéria

- `docker compose up` spustí jádro a Envoy jedním příkazem, build je reprodukovatelný.
- Trim, extend, split, zaoblení a offset ve skicáři fungují přes server, e2e zelené.
- Sdílené případy 2D geometrie projdou v C++.

## Co se naučíš

CMake s vcpkg, generování kódu z `.proto` pro dva jazyky, Envoy a gRPC-Web, první gRPC služba v C++.

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Retrospektiva

_(vyplnit po dokončení; obecné poznatky přesunout do `70-poznatky/`)_
