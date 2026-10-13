---
type: question
status: answered
area: "[[09-vykreslovani]]"
decide_by: "[[M08-vykreslovani]]"
proposal: "Chyba zastaralé generace se zahodí, aktuální se zaloguje a těleso se nezobrazí"
decision: "Zastaralá generace: chyba se zahodí; aktuální: log, těleso se nezobrazí, zbytek scény se vymění"
tags:
  - otazka
created: 2026-10-13
updated: 2026-10-13
---
# Q059 Chyba tessellace v SceneSync

**Oblast:** [[09-vykreslovani]] · **Rozhodnout do:** [[M08-vykreslovani]]

## Otázka

`SceneSync` volá `tessellate` pro nové [[Handle tvaru|handle]]. Mezitím může doběhnout další regenerace a staré handle uvolnit, takže tessellace staršího `sync` skončí chybou `unknown-handle`. Jádro může selhat i jinak (pád workeru). Co s chybou?

## Možnosti a návrh

1. **Podle generace:** pokud `sync` mezitím zastaral, chyba se zahodí (jeho výsledek se zahazuje tak jako tak). Pokud je aktuální, chyba se zaloguje, těleso se nezobrazí a ostatní tělesa se vymění jako obvykle. `sync` se splní (neodmítne).
   - \+ Jeden vadný tvar nezablokuje zobrazení ostatních. + Žádná chyba ze zastaralé práce.
2. **`sync` se odmítne** a scéna zůstane stará.
   - − Jedno těleso zablokuje celé zobrazení.

Návrh: **1**. Hlášení chyb uživateli řeší [[M10-ui|M10]].

## Rozhodnutí

2026-10-13 (Pavel): **možnost 1.** Propsáno do [[09-vykreslovani#Synchronizace s regenerací]].
