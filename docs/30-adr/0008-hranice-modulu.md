---
type: adr
status: accepted
number: 8
aliases:
  - ADR 0008
  - Hranice modulů vynucené nástrojem
date: 2026-10-12
related:
  - "[[01-architektura]]"
supersedes: 
tags:
  - adr
created: 2026-10-12
updated: 2026-10-12
---
# 0008 – Hranice modulů vynucené nástrojem

- **Stav:** Přijato (`status: accepted`)
- **Datum:** 2026-10-12
- **Souvisí:** [[01-architektura]]

## Kontext

Vrstvená architektura funguje, jen dokud se dodržují pravidla závislostí. V TypeScriptu nic nebrání importovat cokoli odkudkoli; jedna zkratka („jen rychle sáhnu z UI na regeneraci“) a hranice se začnou rozpadat.

## Rozhodnutí

- Každý modul v `src/` má veřejné API jen v `index.ts`; importy z cizího modulu jdou jen přes něj.
- Povolené závislosti mezi moduly (tabulka v [[01-architektura|spec 01]]) se kontrolují nástrojem **dependency-cruiser** (`npm run lint:deps`), který je součástí `npm run check`.
- Cyklické závislosti jsou zakázané.

## Zvažované alternativy

- **Monorepo s balíčky (npm workspaces)** – hranice vynucuje přímo build, ale pro jednoho vývojáře je to zbytečná režie (verze, buildy balíčků). Lze přejít později.
- **Jen konvence a review** – nespolehlivé.
- **eslint-plugin-boundaries** – podobné, dependency-cruiser umí navíc vizualizaci grafu závislostí, což se hodí k učení.

## Důsledky

- + Porušení architektury se ukáže hned, ne až při refaktoringu.
- + Graf závislostí jde vygenerovat jako obrázek (`depcruise --output-type dot`).
- − Další konfigurační soubor, který je třeba udržovat se specifikací.
