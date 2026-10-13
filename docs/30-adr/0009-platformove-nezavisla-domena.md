---
type: adr
status: accepted
number: 9
aliases:
  - ADR 0009
  - Doména a prezentační logika nezávislé na platformě
date: 2026-10-13
related:
  - "[[01-architektura]]"
  - "[[0001-jadro-v-cistem-ts]]"
  - "[[0008-hranice-modulu]]"
  - "[[10-interakce]]"
supersedes: 
tags:
  - adr
created: 2026-10-13
updated: 2026-10-13
---
# 0009 – Doména a prezentační logika nezávislé na platformě

- **Stav:** Přijato (`status: accepted`)
- **Datum:** 2026-10-13
- **Souvisí:** [[01-architektura]], [[0001-jadro-v-cistem-ts]], [[0008-hranice-modulu]], [[10-interakce]]

## Kontext

Pavel chce mít datovou vrstvu striktně oddělenou od zobrazování, aby se v případě potřeby dala přenést (jiný UI framework, jiný renderer, desktop, CLI nebo server bez UI).

[[0001-jadro-v-cistem-ts|ADR 0001]] už říká, že doména nezávisí na Vue, Three.js a OCCT. Při kontrole specifikací se ale ukázaly dvě díry:

1. Tabulka závislostí v [[01-architektura]] povoluje `interaction → render`, tedy závislost logiky interakce na konkrétním modulu nad Three.js. ADR 0001 přitom bere `Viewport` jako port.
2. dependency-cruiser hlídá jen importy. Globální objekty prohlížeče (`window`, `document`, `requestAnimationFrame`, `indexedDB`, typ `KeyboardEvent`) jdou použít bez importu, takže by se prohlížeč do domény dostal nepozorovaně. Spec [[10-interakce]] měla `ActionRegistry.handleKey(e: KeyboardEvent)`.

## Rozhodnutí

Moduly jsou rozdělené do **tří prstenců**. Závislosti vedou jen dovnitř (dolů), ven jen události.

| Prstenec | Moduly | Smí znát platformu (DOM, Worker, Vue, Three.js, OCCT) |
|---|---|---|
| 1. Doména | `core`, `document`, `ops`, `regen`, `kernel` (port), `persistence` (port a služby), `plugin-api`, `features/*` | ne |
| 2. Prezentační logika | `interaction` | ne |
| 3. Adaptéry a platforma | `render`, `ui`, `kernel-occt`, `persistence/idb`, `app` | ano |

- **Přenos na jinou platformu znamená přepsat jen prstenec 3.** `app` je [[Kompoziční kořen|kompoziční kořen]] *pro danou platformu*: jiná platforma má vlastní `app`.
- **`Viewport` jako port:** `interaction` definuje `ViewportPort` a typy událostí (`ViewPointerEvent`, `ViewKeyEvent`, `PickResult`). `render` port implementuje a smí z `interaction` importovat **jen typy**. Závislost se tak obrací: dřív `interaction → render`, nově `render ⇢ interaction` (typy). V testech dostane `interaction` `FakeViewport`.
- **Vynucení:** prstence 1 a 2 se typují samostatnou konfigurací `tsconfig.domain.json` s `"lib": ["ES2023"]`, **bez `DOM`**, a ESLint pravidlem `no-restricted-globals` jako druhou pojistkou. Výjimkou jsou adaptéry uvnitř modulu prstence 1 (`persistence/idb`), které se vyjmou cestou. Hranice importů nadále hlídá dependency-cruiser ([[0008-hranice-modulu|ADR 0008]]).
- Ověření v [[M00-zaklad-projektu|M0]]: dočasné použití `window` v `document` musí `npm run check` shodit, stejně jako zakázaný import.

## Zvažované alternativy

- **Ponechat `interaction → render`** – jednodušší, ale nástroje a výběr by se nedaly přenést ani testovat bez Three.js.
- **Port v `core`** – `core` by znal pojmy jako picking a kurzor, které do základních stavebních kamenů nepatří. Rozhraní patří tomu, kdo ho potřebuje.
- **Jen dependency-cruiser bez oddělené `lib`** – nezachytí globální objekty prohlížeče.
- **Monorepo s balíčky a vlastním `tsconfig` pro každý** – vynutí totéž přes build, ale je to zbytečná režie (viz ADR 0008).

## Důsledky

- + Doména a prezentační logika běží v Node, tedy i v CLI, na serveru nebo v desktopové aplikaci. Přenositelnost ověřují testy v každém milníku.
- + Jiný renderer (Babylon, WebGPU) = nový adaptér `ViewportPort`, beze změny nástrojů.
- + Porušení se ukáže už v `typecheck`, ne až při pokusu o přenos.
- − Typy událostí z viewportu (`ViewPointerEvent`, `ViewKeyEvent`) jsou vlastní a `render` (a `ui` pro klávesnici) je musí převádět z DOM událostí.
- − Dvě konfigurace TypeScriptu, které je nutné udržovat v souladu s tabulkou prstenců.
