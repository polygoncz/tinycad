---
type: question
status: answered
area: "[[07-regenerace]]"
decide_by: "[[M06-regenerace]]"
proposal: "cache drží trojici (featura, výstupní stav, status)"
decision: "trojice (featura, výstupní stav, status)"
tags:
  - otazka
created: 2026-10-13
updated: 2026-10-13
---
# Q042 Obsah cache regenerace

**Oblast:** [[07-regenerace]] · **Rozhodnout do:** [[M06-regenerace]]

## Otázka

Spec 07 popisuje cache [[Regenerace|regenerace]] jako dvojici *(instance featury, výstupní [[Stav regenerace|stav]])*. Featura převzatá z cache by ale ztratila svůj status (`warning`, `error`), který UI potřebuje. Co přesně cache ukládá?

## Možnosti a návrh

1. **Trojice (featura, výstupní stav, status).**
   - \+ Status z cache je přesně ten, který vznikl při výpočtu. Chybná featura se nepočítá znovu.
2. **Dvojice + statusy zvlášť v posledním výsledku.**
   - − Dvě struktury, které se musí držet v souladu.

Návrh: **1**.

## Rozhodnutí

2026-10-13: Pavel souhlasí s návrhem (varianta 1). Propsáno do [[07-regenerace]].
