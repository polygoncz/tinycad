---
type: adr
status: accepted
number: 1
aliases:
  - ADR 0001
  - Doména v čistém TypeScriptu, Vue jen jako UI vrstva
date: 2026-10-12
related:
  - "[[01-architektura]]"
  - "[[11-ui]]"
supersedes: 
tags:
  - adr
created: 2026-10-12
updated: 2026-10-12
---
# 0001 – Doména v čistém TypeScriptu, Vue jen jako UI vrstva

- **Stav:** Přijato (`status: accepted`)
- **Datum:** 2026-10-12
- **Souvisí:** [[01-architektura]], [[11-ui]]

## Kontext

Cílem projektu je čistá architektura a dobrý objektový návrh. Aplikace potřebuje UI (Vue, které chceme mít od začátku), 3D vykreslování (Three.js) a geometrické jádro (OCCT ve WASM). Pokud doména závisí na některém z nich, nedá se testovat izolovaně a výměna kterékoli části zasáhne celý kód.

## Rozhodnutí

- Doména (`core`, `document`, `ops`, `regen`, `interaction`) je čistý TypeScript ve `strict` módu bez závislosti na Vue, Three.js a OCCT.
- Vnější systémy jsou za porty (rozhraními) s adaptéry: `GeometryKernel` (OCCT), `DocumentStore` (IndexedDB), `Viewport` (Three.js).
- Vue je v projektu od začátku, ale jen jako nejvyšší vrstva `ui`, která čte stav přes `AppSession` a události.

## Zvažované alternativy

- **Stav aplikace ve Vue/Pinia** – rychlejší start, ale doména by závisela na reaktivitě Vue, proxy by rozbíjely identitu objektů (důležitou pro cache regenerace) a logika by se špatně testovala bez UI.
- **Bez frameworku pro UI** – čistší, ale formuláře, stromy a dialogy by se psaly ručně. Vue tuhle práci ušetří.

## Důsledky

- + Většinu kódu jde testovat v Node bez prohlížeče.
- + UI framework je vyměnitelný.
- − Je potřeba vrstva composables, která převádí události domény na Vue reaktivitu (`useEvent`).
- − Musíme hlídat, aby se doménové objekty nedostaly do `reactive()`.
