---
type: question
status: answered
area: "[[03-dokument]]"
decide_by: "[[M02-dokument]]"
proposal: "fromData vrací Result<DocumentWriter, DocumentLoadError>, mutátory dál hází výjimku"
decision: "fromData vrací Result<DocumentWriter, DocumentLoadError>, mutátory dál hází výjimku"
tags:
  - otazka
created: 2026-10-13
updated: 2026-10-13
---
# Q026 Chyby při načítání dokumentu

**Oblast:** [[03-dokument]] · **Rozhodnout do:** [[M02-dokument]]

## Otázka

Mutátory [[Dokument|dokumentu]] při porušení invariantu (duplicitní `id`, `rollbackIndex` mimo rozsah) hází výjimku – je to chyba programátora. `fromData` ale čte data zvenku ([[05-persistence|persistence]], import souboru). Poškozený nebo ručně upravený soubor není chyba programátora, je to očekávatelný vstup. Jak má `fromData` hlásit neplatná data? Spec dnes říká jen `fromData(...): DocumentWriter`.

Totéž se týká tvaru dat: chybějící `features`, featura bez `id`, `params` jiného typu než objekt.

## Možnosti a návrh

1. **`fromData` vrací `Result<DocumentWriter, DocumentLoadError>`** (`Result` z `core`). `DocumentLoadError` nese seznam problémů s cestou (`studio.features[3].id`). Mutátory dál hází výjimky.
   - \+ Volající (persistence, import) je k ošetření chyby donucen typem. + Odděluje chybu programátora od špatného vstupu.
   - − Odchylka od spec 03, je potřeba ji propsat (a do spec 05).
2. **`fromData` hází výjimku** (stejně jako mutátory).
   - \+ Bez změny spec.
   - − Ošetření závisí na tom, jestli si volající vzpomene na `try/catch`. Míchá dvě různé kategorie chyb.
3. **Opravit, co jde** (přeskočit duplicity, ořezat `rollbackIndex`) a vrátit varování.
   - \+ Uživatel se k dokumentu dostane.
   - − Tichá změna dat. Dá se doplnit později nad možností 1.

Návrh: **1**. Je to stejné rozlišení, jaké používá `core`: `Result` pro očekávatelné selhání, výjimka pro chybu programátora.

## Rozhodnutí

Pavel schválil **možnost 1** (2026-10-13).

- `fromData(data, schemas): Result<DocumentWriter, DocumentLoadError>`. `DocumentLoadError` nese seznam problémů, každý s cestou v datech (`studio.features[3].id`) a zprávou.
- Kontroluje se tvar dat i invarianty dokumentu (unikátní `id`, `rollbackIndex` v rozsahu). Mutátory dál hází výjimku.
- Propsáno do [[03-dokument|03]] a [[05-persistence|05]] (načtení dokumentu chybu předává dál; přesný tvar chyb persistence se upřesní v [[M04-persistence|M4]]).
