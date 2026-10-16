---
type: adr
status: accepted
number: 29
aliases:
  - ADR 0029
  - Text ve skice přes opentype.js
date: 2026-10-16
related:
  - "[[12-skicar]]"
  - "[[0028-geometrie-skici-v-jadre]]"
  - "[[Q091 Fonty pro text ve skice]]"
  - "[[M37-text-ve-skice]]"
supersedes:
tags:
  - adr
created: 2026-10-16
updated: 2026-10-16
---
# 0029 – Text ve skice přes opentype.js

- **Stav:** Přijato (`status: accepted`, Pavel 2026-10-16). Umístění v modulech a fonty upřesní [[M37-text-ve-skice|M37]] a [[Q091 Fonty pro text ve skice|Q091]].
- **Datum:** 2026-10-16
- **Souvisí:** [[0028-geometrie-skici-v-jadre|ADR 0028]], [[12-skicar]]

## Kontext

Pavel chce ve skice psát text, který jde vysunout (gravírování, popisky). Písmena je potřeba převést z fontu na obrysové křivky. Předpřipravený OCCT build nemá třídy fontů (`Font_BRepTextBuilder`, `StdPrs_BRepFont`, `Font_FontMgr`); použít je by znamenalo vlastní build [[M16-vlastni-occt-build|M16]] s FreeType a fonty v souborovém systému WASM.

## Rozhodnutí

1. **Nová knihovna `opentype.js`** (npm) převede řetězec, font a výšku na obrysy písmen: úsečky a kvadratické nebo kubické Bézierovy křivky.
2. **Text je entita skici** s parametry (řetězec, font, výška, poloha a natočení přes body skici). Obrysy písmen se v datech skici neukládají, odvodí se z parametrů. Bézierova křivka se převede přesně na B-spline (`Curve2` druhu `bspline` z [[M29-spliny|M29]]).
3. **Oblasti z obrysů počítá jádro** jako u ostatních křivek ([[0028-geometrie-skici-v-jadre|ADR 0028]]); písmena s dírami (o, a, B) tak řeší OCCT.
4. Knihovna smí být jen v jednom modulu (upřesní M37, pravděpodobně adaptér podobně jako `solver-planegcs`), zbytek vidí jen port.

## Zvažované alternativy

- **OCCT `Font_BRepTextBuilder`** – podle zásady „maximálně OCCT“, ale vyžaduje vlastní build M16 s FreeType; text by čekal.
- **Vlastní parser TrueType** – zbytečná práce, opentype.js je zavedený a malý.

## Důsledky

- (+) Text funguje s dnešním buildem OCCT.
- (+) Obrysy jsou přesné (Bézier je speciální případ B-spline).
- (−) Další závislost a další 2D geometrie mimo OCCT (jen převod písmen na křivky, ne topologie).
- (−) Font musí být k dispozici při každé regeneraci, i v Node testech ([[Q091 Fonty pro text ve skice|Q091]]).

## Upřesnění 2026-10-16 (M37, Q091)

Pavel rozhodl v [[Q091 Fonty pro text ve skice|Q091]]: **obrysy písmen se v datech skici ukládají** (v lokálních souřadnicích textu, jako vyřešené póly `fitSpline`) – mění to bod 2 výše. Řetězec, font a výška zůstávají v entitě jako recept, ze kterého skicář obrysy přepočítá při každé jejich změně; regenerace font ani opentype.js nepotřebuje a jen uložené křivky posune a otočí podle kotevní úsečky. Fonty jsou přibalené (OFL, sans, serif, mono). Knihovna žije v adaptéru `text-opentype` (prstenec 3, jako `solver-planegcs`) za portem `TextOutliner` v `sketch`. Kontrakt v [[12-skicar#Text ve skice (M37)]].

