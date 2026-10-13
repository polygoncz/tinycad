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
updated: 2026-10-12
---
# Q003 Proměnné a výrazy v parametrech

**Oblast:** [[03-dokument]] · **Rozhodnout do:** [[M15-export-a-dokonceni]]

## Otázka

Podporovat proměnné a výrazy v parametrech (`#vyska * 2`) jako Onshape?

## Možnosti a návrh

Hodnota parametru by byla `number | Expr`. `ParamSpec` s `kind: 'length'` to umožní doplnit bez změny pluginů – výraz by se vyhodnotil v [[Regenerace|regeneraci]] před zavoláním builderu. Odloženo za první verzi.

## Rozhodnutí

_(Až se rozhodne: vyplnit sem, nastavit `status: answered` a `decision`, rozhodnutí propsat do [[03-dokument]]. Zásadní rozhodnutí → nové ADR.)_
