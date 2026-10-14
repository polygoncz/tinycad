---
type: question
status: dropped
area: "[[03-dokument]]"
decide_by: "[[M15-export-a-dokonceni]]"
proposal: "Odložit; hodnota number | Expr"
decision: "mimo první verzi; návrh number | Expr a zkrácení cache v Další nápady M15"
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

2026-10-14 (noční rychloakce, [[Rozhodnutí noční rychloakce#M15 – Export a dokončení|R134]]): **Mimo první verzi** → [[M15-export-a-dokonceni#Další nápady (mimo rozsah)|Další nápady]]. Návrh výše (hodnota `number | Expr`, regenerace s `{ features, variables }`, zkrácení cache podle první featury, která proměnnou používá, vyhodnocení před `schema.validate`) zůstává jako výchozí bod. Proč ne teď: dotýká se schématu, validace, regenerace i dialogu a M15 uzavírá verzi. Ve specifikaci se nic nemění.

> [!note] Doplnění z revize architektury (2026-10-14)
> Výraz v parametru je vstup mimo `FeatureInstance`, takže by ho cache podle identity ([[0006-nemenna-data|ADR 0006]], dodatek) neviděla. Návrh pro rozhodnutí: regenerace dostane `{ features, variables }`; při změně identity `variables` se přes `referencesOf`/`dependenciesOf` ([[03-dokument#Id těles a závislosti]]) najde první featura, jejíž parametr proměnnou používá, a cache se zkrátí před ni. Výraz se vyhodnotí před `schema.validate`, builder dál dostává čísla.
