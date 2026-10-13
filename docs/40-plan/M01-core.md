---
type: milestone
status: todo
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
started: 
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

- [ ] `Brand<T, B>` a vzor pro definici ID typů.
- [ ] `IdGenerator`, `RandomIdGenerator` (crypto), `SequentialIdGenerator` (testy).
- [ ] `Emitter<Events>` – `on`, `once`, `emit`, odhlášení během emitu, izolace výjimek.
- [ ] `Observable<T>` a `ObservableValue<T>` ([[0010-prezentacni-model|ADR 0010]]).
- [ ] `Disposable`, `DisposableStore`.
- [ ] `Result`, `ok`, `err`.
- [ ] `assert`, `assertNever`.
- [ ] `Vec3`, `Mat4` a funkce `vec3.*`, `mat4.*` (jen to, co bude potřeba v M6–M8: add, sub, scale, cross, normalize, identity, translation, multiply, transformPoint).
- [ ] `core/rpc`: `createRpcClient`, `serveRpc`, `RpcError`, `transfer()`; testy přes `MessageChannel` v Node.
- [ ] Veřejné API v `core/index.ts`.

## Akceptační kritéria

- Všechny položky mají testy, `npm run check` projde.
- `core` neimportuje nic (ověří `lint:deps`).
- RPC: volání, chyba se zachovaným `code`, transfer `ArrayBuffer` (po přenosu je zdrojový buffer odpojený).

## Co se naučíš

Branded types a pokročilé generické typy v TS (mapované typy pro `Emitter` a RPC protokol); `postMessage` a transferable objekty.

## Retrospektiva

_(vyplnit po dokončení)_
