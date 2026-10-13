---
type: question
status: dropped
area: "[[03-dokument]]"
decide_by: "[[M02-dokument]]"
proposal: "Zacházet s ní jako s neznámou featurou: data beze změny, chyba při regeneraci"
decision: "Nenastane: aplikace běží vždy v nejnovější verzi ze serveru"
tags:
  - otazka
created: 2026-10-13
updated: 2026-10-13
---
# Q025 Featura z novější verze

**Oblast:** [[03-dokument]] · **Rozhodnout do:** [[M02-dokument]]

## Otázka

Spec [[03-dokument|03]] řeší jen migraci nahoru: `fromData` porovná `typeVersion` se `schema.version` a při nižší verzi zavolá `migrate`. Co když dokument uložila novější verze aplikace a featura má `typeVersion` **vyšší** než [[Schéma featury|schéma]], které známe? `migrate` umí jen dopředu a stará aplikace nový formát parametrů nezná.

## Možnosti a návrh

1. **Jako neznámá featura.** Data zůstanou beze změny, featura se při [[Regenerace|regeneraci]] označí chybou („featura z novější verze“). Při uložení se data zapíšou tak, jak přišla.
   - \+ Stejná cesta jako u neznámého typu, žádný nový mechanismus. + Starší aplikace nic neztratí ani nepoškodí.
   - − Uživatel ve staré aplikaci featuru nemůže upravit.
2. **Odmítnout celý dokument** (`fromData` selže).
   - \+ Nejjednodušší, žádný polovičatý stav.
   - − Jedna featura zablokuje otevření celého dokumentu, což jde proti duchu „neznámý typ dokument nerozbije“.
3. **Zkusit data použít** a spolehnout se na `validate`.
   - − Tichá ztráta nebo poškození dat při uložení. Nepřijatelné.

Návrh: **1**. Sjednotí se s neznámým typem a chrání data.

## Rozhodnutí

Pavel (2026-10-13): **otázka odpadá.** Aplikace se vždy načítá ze serveru v nejnovější verzi, takže dokument uložený novější verzí, než jakou uživatel právě spouští, nevznikne. Spec [[03-dokument|03]] se nemění.
