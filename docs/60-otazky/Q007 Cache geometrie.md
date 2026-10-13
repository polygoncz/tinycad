---
type: question
status: open
area: "[[05-persistence]]"
decide_by: "[[M15-export-a-dokonceni]]"
proposal: "Až bude regenerace pomalá"
decision: ""
tags:
  - otazka
created: 2026-10-12
updated: 2026-10-12
---
# Q007 Cache geometrie

**Oblast:** [[05-persistence]] · **Rozhodnout do:** [[M15-export-a-dokonceni]]

## Otázka

Ukládat cache geometrie (BREP přes `BinTools` nebo hotové sítě) pro rychlé otevření velkých dokumentů?

## Možnosti a návrh

Klíčovaná hashem receptu, při nesouladu se zahodí. Řešit, až bude regenerace při otevření pomalá. Souvisí s [[Q008 OPFS nebo IndexedDB]].

## Rozhodnutí

_(Až se rozhodne: vyplnit sem, nastavit `status: answered` a `decision`, rozhodnutí propsat do [[05-persistence]]. Zásadní rozhodnutí → nové ADR.)_
