---
type: question
status: answered
area: "[[01-architektura]]"
decide_by: "[[M15-export-a-dokonceni]]"
proposal: "Zatím jedno Part Studio"
decision: "jedno Part Studio; víc záložek je v Další nápady M15"
tags:
  - otazka
created: 2026-10-12
updated: 2026-10-14
---
# Q001 Jedno nebo více Part Studií

**Oblast:** [[01-architektura]] · **Rozhodnout do:** [[M15-export-a-dokonceni]]

## Otázka

Má dokument obsahovat jedno Part Studio, nebo rovnou podporovat více záložek jako Onshape?

## Možnosti a návrh

Zatím jedno. Model s tím počítá – `CadDocument.partStudio` se může později změnit na mapu. Rozhodnout, až bude jasné, jestli to vůbec chceme.

## Rozhodnutí

2026-10-14 (noční rychloakce, [[Rozhodnutí noční rychloakce#M15 – Export a dokončení|R134]]): **Jedno Part Studio.** První verze víc nepotřebuje a nic v M11–M15 na tom nestojí. `PartStudioData` zůstává jediné pole dokumentu; víc záložek je v [[M15-export-a-dokonceni#Další nápady (mimo rozsah)|Další nápady]] a změna `studio` na mapu by byla migrace dokumentu (`fromData`), ne předem připravený model. Propsáno do [[03-dokument#Model]].
