---
type: milestone
status: done
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
finished: 2026-10-13
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

**Co bylo jinak, než se čekalo**
- Spec 02 a [[0009-platformove-nezavisla-domena|ADR 0009]] si odporovaly: `core` počítal s `console`, `crypto` a typy `MessagePort`, které v doméně bez DOM neexistují. Řešením je injekce a vlastní strukturální typy ([[Q022 Platformové typy v core|Q022]]). `Emitter` proto chyby nelogujeme, ale vyhazuje je, až doběhnou všechny handlery.
- Pravidlo „`core` neimportuje nic“ vydrželo jeden den. Výhled na inverze, roviny a paprsky vedl k porovnání knihoven a ke gl-matrix za fasádou ([[0012-gl-matrix-za-fasadou|ADR 0012]], [[Q024 Knihovna pro vektorovou matematiku|Q024]]). Vlastní `vec3`/`mat4` z prvního průchodu nebyly zbytečné: jejich testy ověřily, že fasáda drží naše konvence.
- Detaily TypeScriptu, které na papíře nebyly vidět: `Record<string, unknown>` neprojde s `interface` (potřeba samoreferenční omezení), `erasableSyntaxOnly` zakazuje parameter properties, `Uint8Array` je od TS 5.7 generický podle bufferu a `MessagePort.postMessage` má v přetížení povinný `transfer`.
- `architecture-reviewer` našel dvě skutečné chyby, které testy nepokryly: zablokovanou frontu RPC serveru po nezkopírovatelném výsledku a nekonečnou smyčku generátoru ID s rozbitým zdrojem náhody. Upozornil také, že `events: Emitter` ve veřejných rozhraních prozrazuje `emit` ([[Q023 Události jen pro odběr|Q023]]).

**Co se osvědčilo**
- Test nejdřív a ověřit, že selže: odhalil i to, že na macOS neexistuje příkaz `timeout`, když „prázdný výstup“ vypadal jako úspěch.
- Ověřovat předpoklady překladem a během, ne čtením: chybějící globály v ES2023, `readonly` n-tice proti typům knihoven, float32 vs. float64 v gl-matrix, `null`/`NaN` při singulární inverzi.
- RPC testované přes skutečný `MessageChannel` v Node: typecheck tím zároveň dokázal, že vlastní `MessageEndpoint` sedí na skutečný port.
- Revize architektury až na konci milníku, nad hotovým celkem.
