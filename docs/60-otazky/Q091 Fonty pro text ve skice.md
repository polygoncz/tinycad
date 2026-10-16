---
type: question
status: answered
area: "[[12-skicar]]"
decide_by: "[[M37-text-ve-skice]]"
proposal: "Přibalené OFL fonty (sans, serif, mono), v dokumentu jen id fontu; obrysy písmen uložené v datech entity v lokálních souřadnicích, regenerace font nepotřebuje."
decision: "Podle návrhu: tři přibalené OFL fonty, obrysy uložené v datech (Pavel 2026-10-16)."
tags:
  - otazka
created: 2026-10-16
updated: 2026-10-16
---
# Q091 Fonty pro text ve skice

**Oblast:** [[12-skicar]], [[0029-text-ve-skice-pres-opentype|ADR 0029]] · **Rozhodnout do:** [[M37-text-ve-skice]]

## Otázka

Text se z fontu převádí na křivky při každé regeneraci ([[0029-text-ve-skice-pres-opentype|ADR 0029]]). Odkud se font bere?

- **Přibalené fonty** (pár volných fontů s licencí OFL v aplikaci): deterministické, dokument je přenositelný, výběr omezený.
- **Systémové fonty** (Local Font Access API): velký výběr, ale jen v Chromiu a dokument na jiném počítači může font nemít.
- **Font uložený v dokumentu** (nahraný soubor): přenositelné, ale dokument roste a persistence musí umět binární data.

A dále: jak se chová regenerace, když font chybí (chyba featury, náhradní font)? Jak se font dostane do workeru regenerace a do Node testů?

## Možnosti a návrh

Zdroj fontu:
- a) **Přibalené OFL fonty** – deterministické, přenositelné, fungují v Node testech. Výběr omezený.
- b) Systémové fonty (Local Font Access API) – jen Chromium, dokument jinde font nemusí mít.
- c) Nahraný font v dokumentu – persistence binárních dat, dokument roste.

Kde žijí obrysy:
- A) **Uložené v datech** entity v lokálních souřadnicích textu (jako vyřešené póly `fitSpline`): font a opentype.js potřebuje jen skicář při zadání nebo změně textu; regenerace jen posune a otočí uložené křivky podle kotvy. Chybějící font při regeneraci nenastane, worker ani Node testy builderu font nepotřebují.
- B) Odvozené při každé regeneraci (původní bod 2 [[0029-text-ve-skice-pres-opentype|ADR 0029]]) – builder i kresba potřebují port s načteným fontem všude, chybějící font = chyba featury.

**Návrh:** a) + A, tři fonty sans, serif, mono.

## Rozhodnutí

Pavel 2026-10-16: **přibalené OFL fonty** (tři: sans, serif, mono; podmnožina latinky s českou diakritikou, načtené až při prvním použití), v dokumentu jen id fontu; **obrysy uložené v datech** entity v lokálních souřadnicích. Upřesňuje bod 2 [[0029-text-ve-skice-pres-opentype|ADR 0029]]. Kontrakt v [[12-skicar#Text ve skice (M37)]].
