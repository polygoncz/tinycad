---
type: question
status: answered
area: "[[13-testovani]]"
decide_by: "[[M38-zmrazeni-domeny]]"
proposal: "Výchozí tolerance: délky 1e-6 mm absolutně, úhly 1e-9 rad, objem a plocha 1e-6 relativně; případ si může nastavit volnější."
decision: "Výchozí tolerance length 1e-6 mm, angle 1e-9 rad, relative 1e-6; případ je může přepsat ve vlastnosti tolerance. Objem tělesa v případech regenerace je ze sítě, s relativní tolerancí 1e-3."
tags:
  - otazka
created: 2026-10-17
updated: 2026-10-17
---
# Q110 Tolerance sdílených případů

**Oblast:** [[13-testovani]], [[06-geometricke-jadro]] · **Rozhodnout do:** [[M38-zmrazeni-domeny|M38]]

## Otázka

Čísla ze [[Sdílený testovací případ|sdílených případů]] se mezi OCCT ve WASM a nativním OCCT 8 nebudou shodovat bit po bitu. Jaké tolerance platí, když je případ nenastaví?

## Možnosti a návrh

**A. Tři výchozí tolerance (návrh).** `length` 1e-6 mm absolutně (souřadnice, obálky, poloměry), `angle` 1e-9 rad, `relative` 1e-6 (objem, plocha). Případ je může přepsat ve vlastnosti `tolerance`, například u splajnů a offsetů, kde OCCT aproximuje.
- \+ Mm a radiány jsou jednotky domény ([[01-architektura#Souřadnice a jednotky]]). 1e-6 mm je hluboko pod tolerancí OCCT (`Precision::Confusion()` = 1e-7 se týká shody bodů, ne výsledků výpočtu) a pořád tisíckrát pod tím, co je vidět.
- \+ Objem a plocha rostou s velikostí tělesa, proto relativně.
- − Některé případy (aproximace) bude potřeba povolit ručně. To je ale vědomé rozhodnutí v datech případu.

**B. Jedna tolerance pro všechno.**
- − Objem 1e6 mm³ s absolutní tolerancí 1e-6 je přísnější než přesnost OCCT.

## Rozhodnutí

**Varianta A (Pavel 2026-10-17, podle návrhu Clauda).**

Upřesnění (Pavel 2026-10-17): TS jádro nad OCCT ve WASM objem neumí a doména je zmrazená, takže rekordér spočítá **objem z jemné sítě** (`linearDeflection` 0,01, `angularDeflection` 0,05, jako dnešní integrační testy) a případy regenerace mají pro objem `relative` 1e-3. C++ porovná svůj přesný objem (`BRepGProp`) s touto tolerancí. Propsáno do [[13-testovani#Sdílené testovací případy]].
