---
type: question
status: answered
area: "[[07-regenerace]]"
decide_by: "[[M06-regenerace]]"
proposal: "výjimka s kódem jádra (kernelErrorCode) → chyba featury KERNEL, jiná výjimka se vyhodí dál"
decision: "jen výjimky jádra jsou chyba featury, ostatní je chyba programu a letí dál"
tags:
  - otazka
created: 2026-10-13
updated: 2026-10-13
---
# Q043 Výjimka builderu mimo jádro

**Oblast:** [[07-regenerace]] · **Rozhodnout do:** [[M06-regenerace]]

## Otázka

Spec 07 dovoluje [[Builder featury|builderu]] nechat proletět výjimky jádra a [[Regenerace|regenerace]] je převede na chybu featury `KERNEL`. Co s výjimkou, která z jádra nepochází (`TypeError`, chyba v pluginu)?

## Možnosti a návrh

1. **Rozlišit přes `kernelErrorCode(e) !== undefined`:** chyba jádra → status `error` s kódem `KERNEL`, jiná výjimka se vyhodí z `run` (po úklidu handle).
   - \+ Chyba programu se neschová do červené featury.
   - − Chyba v pluginu shodí regeneraci (v M10 ji zachytí `app`).
2. **Všechno na `KERNEL`.**
   - − Bug v pluginu vypadá jako geometrický problém.

Návrh: **1**.

## Rozhodnutí

2026-10-13: Pavel souhlasí s návrhem (varianta 1). Propsáno do [[07-regenerace]].
