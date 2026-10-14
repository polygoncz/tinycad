---
type: question
status: answered
area: "[[04-operace-a-historie]]"
decide_by: "[[M15-export-a-dokonceni]]"
proposal: "Zatím lineární log"
decision: "lineární log; větvení a návrat z panelu historie v Další nápady M15"
tags:
  - otazka
created: 2026-10-12
updated: 2026-10-14
---
# Q006 Větvení operačního logu

**Oblast:** [[04-operace-a-historie]] · **Rozhodnout do:** [[M15-export-a-dokonceni]]

## Otázka

Má mít [[Operační log|operační log]] větvení (`parent`) jako verze v Onshape?

## Možnosti a návrh

Zatím ne – lineární log. Pole `parent` jde přidat později bez migrace starých záznamů (chybějící = předchozí seq).

## Rozhodnutí

2026-10-14 (noční rychloakce, [[Rozhodnutí noční rychloakce#M15 – Export a dokončení|R134]]): **Lineární log.** Panel historie z M15 ([[10-interakce#Historie úprav: `HistoryModel`]]) log jen ukazuje, včetně změn zahozených novým `do` po undo (stav `abandoned`), ale návrat k nim nenabízí – to by bylo větvení. Pole `parent` jde přidat později bez migrace (chybějící = předchozí `seq`). Větvení je v [[M15-export-a-dokonceni#Další nápady (mimo rozsah)|Další nápady]]. Propsáno do [[04-operace-a-historie#Log]].
