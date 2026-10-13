---
type: adr
status: accepted
number: 3
aliases:
  - ADR 0003
  - Dokument je recept, geometrie je odvozená
date: 2026-10-12
related:
  - "[[01-architektura]]"
  - "[[03-dokument]]"
supersedes: 
tags:
  - adr
created: 2026-10-12
updated: 2026-10-12
---
# 0003 – Dokument je recept, geometrie je odvozená

- **Stav:** Přijato (`status: accepted`)
- **Datum:** 2026-10-12
- **Souvisí:** [[01-architektura]], [[03-dokument]]

## Kontext

Parametrický CAD s historií (Onshape, SolidWorks) umožňuje změnit parametr kterékoli featury a model se přepočítá. Je potřeba rozhodnout, co je „zdroj pravdy“: geometrie, nebo postup, jak vznikla.

## Rozhodnutí

Zdrojem pravdy je **seřazený seznam featur s parametry** (recept). Geometrie je vždy výsledkem přehrání (regenerace) a neukládá se. Rollback bar určuje, kam až se přehrává.

## Zvažované alternativy

- **Ukládat geometrii (B-rep) a historii vedle sebe** – rychlé otevření, ale dvě pravdy, které se mohou rozejít. Může přijít později jen jako **cache** klíčovaná hashem receptu.
- **Přímé modelování bez historie** – jiný typ CAD, mimo cíl projektu.

## Důsledky

- + Dokument je malý JSON, snadno serializovatelný, verzovatelný a migrovatelný.
- + Undo/redo i ukládání pracují jen s daty, ne s geometrií.
- + Neplatný stav (featura, která nejde spočítat) je legitimní – featura je jen označená chybou.
- − Otevření dokumentu znamená přepočet celé historie (pomalé u velkých modelů).
- − Odkazy na geometrii mezi featurami vyžadují topologické pojmenování ([[0007-vlastni-topologicke-pojmenovani|ADR 0007]]).
