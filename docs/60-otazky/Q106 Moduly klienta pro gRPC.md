---
type: question
status: answered
area: "[[01-architektura]]"
decide_by: "[[M39-kostra-serveru]]"
proposal: "Vygenerovaný kód v novém modulu src/protocol (prstenec 3, generovaný při buildu, ne v gitu); adaptéry portů nad ním v novém modulu src/remote, který importuje jen app."
decision: "Dva nové moduly v prstenci 3: src/protocol (jen kód vygenerovaný buf generate, ne v gitu) a src/remote (adaptéry portů a klient connect-web); protocol importuje jen remote, remote jen app."
tags:
  - otazka
created: 2026-10-17
updated: 2026-10-17
---
# Q106 Moduly klienta pro gRPC

**Oblast:** [[01-architektura]], [[14-protokol]] · **Rozhodnout do:** [[M39-kostra-serveru|M39]]

## Otázka

Klient dostane kód vygenerovaný z `.proto` (protobuf-es, [[Q104 Nástroje pro kontrakt a C++ server|Q104]]) a adaptéry, které nad ním implementují porty (`SketchGeometry`, později sezení a read model). Do kterých modulů to patří a je vygenerovaný kód v gitu?

## Možnosti a návrh

**A. Dva nové moduly (návrh).** `src/protocol/` jen s vygenerovaným kódem (prstenec 3, [[0009-platformove-nezavisla-domena|ADR 0009]]) a `src/remote/` s adaptéry portů a klientem connect-web, který jako jediný importuje `protocol` a sám ho importuje jen `app`. Doména zprávy protobufu nikdy nevidí, převod na doménové typy je v adaptéru ([[Port a adaptér]]).
- \+ Stejný vzor jako `kernel-occt`: konkrétní technologie za portem, jeden modul ji zná.
- − Dva moduly navíc v tabulce závislostí a v `.dependency-cruiser.cjs`.

**B. Vše v `app`.**
- − `app` je kompoziční kořen, ne adaptér. Rostl by o tisíce řádků převodů.

**Vygenerovaný kód v gitu?** Ne (návrh): generuje se `buf generate` před `typecheck`, jinak se v revizích míchá ruční a generovaný kód. Rozhodne se spolu s modulem.

## Rozhodnutí

**Varianta A, kód se generuje (Pavel 2026-10-17, podle návrhu Clauda).**

- `src/protocol/`: jen výstup `buf generate` (protobuf-es, `tinycad/v1/*_pb.ts`). Smí ho importovat jen `remote`. ESLint i Prettier ho ignorují.
- `src/remote/`: adaptéry portů (`createRemoteSketchGeometry`, později sezení a read model), klient `@connectrpc/connect-web` a převody zpráv ↔ doménové typy. Smí importovat `core`, `sketch` (porty a typy), `protocol` a balíky `@bufbuild/protobuf`, `@connectrpc/*`; sám ho importuje jen `app`.
- Vygenerovaný kód **není v gitu** (`.gitignore`). Skript `npm run gen:proto` (`buf generate` přes dev závislosti `@bufbuild/buf` a `@bufbuild/protoc-gen-es`, bez Dockeru) běží před `typecheck`, `dev` a `build`.

Do [[01-architektura]] (tabulka modulů a prstenců) a `.dependency-cruiser.cjs` se to propíše v [[M39-kostra-serveru|M39]], až moduly vzniknou.
