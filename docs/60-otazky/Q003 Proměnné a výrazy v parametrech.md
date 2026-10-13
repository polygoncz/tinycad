---
type: question
status: open
area: "[[03-dokument]]"
decide_by: "[[M15-export-a-dokonceni]]"
proposal: "Odložit; hodnota number | Expr"
decision: ""
tags:
  - otazka
created: 2026-10-12
updated: 2026-10-14
---
# Q003 Proměnné a výrazy v parametrech

**Oblast:** [[03-dokument]] · **Rozhodnout do:** [[M15-export-a-dokonceni]]

## Otázka

Podporovat proměnné a výrazy v parametrech (`#vyska * 2`) jako Onshape?

## Možnosti a návrh

Hodnota parametru by byla `number | Expr`. `ParamSpec` s `kind: 'length'` to umožní doplnit bez změny pluginů – výraz by se vyhodnotil v [[Regenerace|regeneraci]] před zavoláním builderu. Odloženo za první verzi.

## Rozhodnutí

_(Až se rozhodne: vyplnit sem, nastavit `status: answered` a `decision`, rozhodnutí propsat do [[03-dokument]]. Zásadní rozhodnutí → nové ADR.)_

> [!note] Doplnění z revize architektury (2026-10-14)
> Výraz v parametru je vstup mimo `FeatureInstance`, takže by ho cache podle identity ([[0006-nemenna-data|ADR 0006]], dodatek) neviděla. Návrh pro rozhodnutí: regenerace dostane `{ features, variables }`; při změně identity `variables` se přes `referencesOf`/`dependenciesOf` ([[03-dokument#Id těles a závislosti]]) najde první featura, jejíž parametr proměnnou používá, a cache se zkrátí před ni. Výraz se vyhodnotí před `schema.validate`, builder dál dostává čísla.
