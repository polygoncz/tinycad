---
type: question
status: answered
area: "[[10-interakce]]"
decide_by: "[[M09-interakce]]"
proposal: "Signál nové generace přes port z Q063"
decision: "Port FeatureStatusSource nese číslo generace; interaction při změně vyčistí výběr podtvarů"
tags:
  - otazka
created: 2026-10-13
updated: 2026-10-13
---
# Q064 Výběr po regeneraci

**Oblast:** [[10-interakce]] · **Rozhodnout do:** [[M09-interakce]]

## Otázka

Indexy ploch a hran ve [[Výběr|výběru]] platí jen pro jednu [[Regenerace|regeneraci]]. Do M14 se má výběr podtvarů po regeneraci vyčistit. Kdo `interaction` řekne, že regenerace proběhla?

## Možnosti a návrh

1. **Signál přes port** – port z [[Q063 Stav regenerace v interaction|Q063]] nese i číslo generace; `interaction` při změně vyčistí položky `face`/`edge`.
   - + pravidlo žije v `interaction` a je testované.
2. **`app` volá `selection.clear()`** po regeneraci.
   - + méně kódu. − pravidlo v kompozičním kořeni, netestované v Node.

Návrh: **1**.

## Rozhodnutí

2026-10-13 (Pavel): **možnost 1.** Čistí se jen `face` a `edge`, položky `feature` a `body` zůstávají. Propsáno do [[10-interakce]].
