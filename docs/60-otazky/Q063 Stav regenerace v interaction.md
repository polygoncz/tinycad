---
type: question
status: answered
area: "[[10-interakce]]"
decide_by: "[[M09-interakce]]"
proposal: "Port FeatureStatusSource definovaný v interaction"
decision: "Port FeatureStatusSource v interaction, plní ho app z RegenState"
tags:
  - otazka
created: 2026-10-13
updated: 2026-10-13
---
# Q063 Stav regenerace v interaction

**Oblast:** [[10-interakce]] · **Rozhodnout do:** [[M09-interakce]]

## Otázka

[[Prezentační model|Prezentační model]] `FeatureTreeModel` má u řádku ukazovat stav featury (ok, chyba, potlačeno, za [[Rollback bar|rollback barem]]). Typ `FeatureStatus` ale patří do `regen` a `interaction` ho importovat nesmí ([[01-architektura]], akceptační kritérium [[M09-interakce]]). Odkud stav vezme?

## Možnosti a návrh

1. **Port v `interaction`** – `interaction` definuje `FeatureStatusSource` s vlastním typem stavu; `app` ho naplní z [[Stav regenerace|RegenState]] (adaptér). Stejný vzor jako `ViewportPort` ([[0009-platformove-nezavisla-domena|ADR 0009]]).
   - + prstenec 2 nezná regeneraci, testuje se s ručně plněným fake.
   - − malý převod stavů v `app`.
2. **Povolit typy z `regen`** – změna tabulky závislostí.
   - + méně kódu.
   - − `interaction` závisí na regeneraci, porušení akceptačního kritéria.

Návrh: **1**.

## Rozhodnutí

2026-10-13 (Pavel): **možnost 1.** Tvar portu viz [[10-interakce]].
