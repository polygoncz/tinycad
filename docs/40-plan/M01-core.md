---
type: milestone
status: doing
order: 1
aliases:
  - M1
  - M1 Core
modules:
  - core
specs:
  - "[[02-core]]"
depends_on:
  - "[[M00-zaklad-projektu]]"
started: 2026-10-13
finished: 
tags:
  - milnik
created: 2026-10-12
updated: 2026-10-13
---
# M1 – Core

**Cíl:** malý, stabilní a dokonale otestovaný základ, na kterém stojí všechny ostatní moduly.

**Specifikace:** [[02-core|02 – core]]

**Navazuje na:** [[M00-zaklad-projektu]]

## Úkoly

- [x] `Brand<T, B>` a vzor pro definici ID typů.
- [x] `IdGenerator`, `createRandomIdGenerator(random)` (zdroj náhody zvenku, [[Q022 Platformové typy v core|Q022]]), `createSequentialIdGenerator` (testy).
- [x] `Emitter<Events>` – `on`, `once`, `emit`, odhlášení během emitu, izolace výjimek.
- [x] `Observable<T>` a `ObservableValue<T>` ([[0010-prezentacni-model|ADR 0010]]).
- [x] `Registry<T>` a `createRegistry` ([[0011-programovani-proti-rozhranim|ADR 0011]]).
- [x] `Disposable`, `DisposableStore`.
- [x] `Result`, `ok`, `err`.
- [x] `assert`, `assertNever`.
- [x] `Vec3`, `Mat4` a funkce `vec3.*`, `mat4.*` podle [[02-core]] (jen to, co bude potřeba v M6–M8: add, sub, scale, dot, cross, length, normalize, equals; identity, translation, rotationAxisAngle, multiply, transformPoint).
- [x] `core/rpc`: `createRpcClient`, `serveRpc`, `RpcError`, `transfer()`; testy přes `MessageChannel` v Node.
- [x] Veřejné API v `core/index.ts`.

## Akceptační kritéria

- Všechny položky mají testy, `npm run check` projde.
- `core` neimportuje nic kromě `gl-matrix` v `src/core/math/` ([[0012-gl-matrix-za-fasadou|ADR 0012]]), ověří `lint:deps`.
- RPC: volání, chyba se zachovaným `code`, transfer `ArrayBuffer` (po přenosu je zdrojový buffer odpojený).

## Co se naučíš

Branded types a pokročilé generické typy v TS (mapované typy pro `Emitter` a RPC protokol); `postMessage` a transferable objekty.

## Retrospektiva

_(vyplnit po dokončení)_
