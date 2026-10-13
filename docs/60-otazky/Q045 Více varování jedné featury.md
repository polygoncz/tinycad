---
type: question
status: answered
area: "[[07-regenerace]]"
decide_by: "[[M06-regenerace]]"
proposal: "zprávy z více volání warn spojit novým řádkem"
decision: "spojit novým řádkem"
tags:
  - otazka
created: 2026-10-13
updated: 2026-10-13
---
# Q045 Více varování jedné featury

**Oblast:** [[07-regenerace]] · **Rozhodnout do:** [[M06-regenerace]]

## Otázka

Status featury `{ kind: 'warning'; message }` nese jednu zprávu. Co když builder zavolá `warn` víckrát?

## Možnosti a návrh

1. **Spojit zprávy znakem `\n`** v pořadí volání.
   - \+ Žádná změna typu, nic se neztratí.
2. **Pole zpráv** (`messages: string[]`).
   - − Změna typu kvůli případu, který zatím žádný builder nemá.
3. **Jen první zpráva.**
   - − Ztráta informace.

Návrh: **1**.

## Rozhodnutí

2026-10-13: Pavel souhlasí s návrhem (varianta 1). Propsáno do [[07-regenerace]].
