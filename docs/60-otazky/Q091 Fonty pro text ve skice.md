---
type: question
status: open
area: "[[12-skicar]]"
decide_by: "[[M37-text-ve-skice]]"
proposal: ""
decision: ""
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

_(Doplnit při startu M37.)_

## Rozhodnutí
