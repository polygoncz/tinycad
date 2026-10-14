---
type: question
status: answered
area: "[[07-regenerace]]"
decide_by: "[[M15-export-a-dokonceni]]"
proposal: "Lineární přepočet stačí"
decision: "lineární přepočet od první změny (jako Onshape); graf jen při naměřené potřebě"
tags:
  - otazka
created: 2026-10-12
updated: 2026-10-14
---
# Q013 Graf závislostí featur

**Oblast:** [[07-regenerace]] · **Rozhodnout do:** [[M15-export-a-dokonceni]]

## Otázka

Přepočítávat podle grafu závislostí mezi featurami místo lineárně od první změny?

## Možnosti a návrh

Zbytečné, dokud je [[Regenerace|regenerace]] rychlá. Onshape také přepočítává lineárně od změny.

## Rozhodnutí

2026-10-14 (noční rychloakce, [[Rozhodnutí noční rychloakce#M15 – Export a dokončení|R134]]): **Lineární přepočet** od první změněné featury, s cache podle identity ([[07-regenerace#Cache podle identity]]). Graf závislostí existuje od M10.1 (`dependenciesOf`), ale používá se jen pro pravidla mazání a přesunu; přeskakování nezávislých featur by změnilo pořadí a determinismus regenerace a Onshape to také nedělá. Měření M15 (Ú6) změří plný přepočet a přepočet z cache. Graf pro přepočet je v [[M15-export-a-dokonceni#Další nápady (mimo rozsah)|Další nápady]]. Ve specifikaci se nic nemění.
