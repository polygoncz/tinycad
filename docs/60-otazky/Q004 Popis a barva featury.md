---
type: question
status: dropped
area: "[[03-dokument]]"
decide_by: "[[M15-export-a-dokonceni]]"
proposal: "Až bude potřeba"
decision: "mimo první verzi; barva je u těles (Q073), popis featury v Další nápady M15"
tags:
  - otazka
created: 2026-10-12
updated: 2026-10-14
---
# Q004 Popis a barva featury

**Oblast:** [[03-dokument]] · **Rozhodnout do:** [[M15-export-a-dokonceni]]

## Otázka

Má mít [[Featura|featura]] volitelný uživatelský popis nebo barvu?

## Možnosti a návrh

Až bude potřeba. Přidání volitelného pole do `FeatureInstance` nevyžaduje migraci.

## Rozhodnutí

2026-10-14 (noční rychloakce, [[Rozhodnutí noční rychloakce#M15 – Export a dokončení|R134]]): **Mimo první verzi** → [[M15-export-a-dokonceni#Další nápady (mimo rozsah)|Další nápady]]. Barvu má od M15 **těleso** ([[Q073 Průhlednost a barva těles|Q073]]) – je to vzhled výsledku, ne featury. Popis featury zatím nikdo nepotřebuje; volitelné pole `FeatureInstance.description` půjde přidat bez migrace.
