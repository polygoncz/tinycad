---
type: adr
status: accepted
number: 6
aliases:
  - ADR 0006
  - Neměnná doménová data, cache regenerace podle identity
date: 2026-10-12
related:
  - "[[03-dokument]]"
  - "[[07-regenerace]]"
supersedes: 
tags:
  - adr
created: 2026-10-12
updated: 2026-10-12
---
# 0006 – Neměnná doménová data, cache regenerace podle identity

- **Stav:** Přijato (`status: accepted`)
- **Datum:** 2026-10-12
- **Souvisí:** [[03-dokument]], [[07-regenerace]]

## Kontext

Regenerace má přepočítat jen featury od první změněné dál. Je potřeba spolehlivě zjistit, která featura se změnila. Explicitní invalidace (každá operace hlásí „změnil jsem index k“) je křehká – stačí jedna zapomenutá a cache je špatně.

Zároveň snapshot pro ukládání musí být konzistentní, i když se zapisuje asynchronně.

## Rozhodnutí

- `FeatureInstance`, `PartStudioData` a všechna doménová data jsou **neměnná** (`readonly` v typech, v dev režimu `Object.freeze`).
- Změna = nový objekt pro změněnou featuru a nové pole featur; nezměněné featury zůstávají **tytéž objekty** (strukturální sdílení).
- Regenerator najde první změněnou pozici porovnáním **identity** (`!==`) s instancí uloženou v cache.
- Stejný princip platí pro `RegenState` (neměnná mapa těles).

## Zvažované alternativy

- **Explicitní invalidační index z handlerů operací** – funguje, ale každá nová operace musí invalidaci správně spočítat.
- **Hash parametrů** – robustní, ale zbytečně drahý, když máme identitu zadarmo.
- **Měnitelné objekty + dirty flagy** – klasický přístup, náchylný na chyby a souběh s asynchronní regenerací.

## Důsledky

- + Cache je správná automaticky pro jakoukoli operaci, i budoucí.
- + Snapshot (`toData`) je levný a konzistentní kdykoli.
- + Vue nemůže nic omylem změnit (ale pozor na proxy – viz [[0001-jadro-v-cistem-ts|ADR 0001]]).
- − Víc alokací (zanedbatelné u desítek až stovek featur).
- − Je potřeba disciplína: nikdy nemutovat, vždy kopírovat.
