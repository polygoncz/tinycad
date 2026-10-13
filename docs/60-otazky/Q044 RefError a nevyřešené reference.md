---
type: question
status: answered
area: "[[07-regenerace]]"
decide_by: "[[M06-regenerace]]"
proposal: "RefError { ref, message }; builder z něj vrátí chybu UNRESOLVED_REFERENCE"
decision: "RefError { ref: BodyRef; message }, převod na UNRESOLVED_REFERENCE dělá builder"
tags:
  - otazka
created: 2026-10-13
updated: 2026-10-13
---
# Q044 RefError a nevyřešené reference

**Oblast:** [[07-regenerace]] · **Rozhodnout do:** [[M06-regenerace]]

## Otázka

`BuildContext.resolveBodies` vrací `Result<Body[], RefError>`, ale typ `RefError` není nikde definovaný a není jasné, kdo ho převede na chybu featury `UNRESOLVED_REFERENCE`.

## Možnosti a návrh

1. **`RefError { ref: BodyRef; message: string }`** (první nevyřešená reference), builder vrátí `{ ok: false, error: { code: 'UNRESOLVED_REFERENCE', message } }`.
   - \+ Builder může chybu doplnit kontextem, kontrakt builderu zůstává jednoduchý.
2. **`resolveBodies` hází výjimku, kterou chytí regenerace.**
   - − Výjimky pro očekávaný stav, odporuje pravidlu „očekávaná chyba = `{ ok: false }`“.

Návrh: **1**. V M14 se `ref` rozšíří o `TopoRef`.

## Rozhodnutí

2026-10-13: Pavel souhlasí s návrhem (varianta 1). Propsáno do [[07-regenerace]].
