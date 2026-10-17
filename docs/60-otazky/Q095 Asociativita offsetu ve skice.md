---
type: question
status: answered
area: "[[12-skicar]]"
decide_by: "[[M35-offset]]"
proposal: "Asociativní vazba offset pro úsečky, oblouky a kružnice (jedna kóta d, řešič z primitiv); spline zapečený."
decision: "Podle návrhu (Pavel 2026-10-17): vazba offset; rohy ostré (prodloužit); klik vybere celý řetězec."
tags:
  - otazka
created: 2026-10-17
updated: 2026-10-17
---
# Q095 Asociativita offsetu ve skice

**Oblast:** [[12-skicar]], [[0028-geometrie-skici-v-jadre|ADR 0028]] · **Rozhodnout do:** [[M35-offset]]

## Otázka

Offset (ekvidistanta) vybrané křivky nebo řetězce vytvoří nové křivky ve vzdálenosti `d`. Má offset po vytvoření **sledovat originál** (změna originálu nebo kóty `d` přepočítá offset), nebo vzniknou jen nové nezávislé entity? Druh vazby `offset` je pro stopu A rezervovaný ([[12-skicar#Sdílené kontrakty série II]]).

## Možnosti a návrh

1. **Jen nové entity** („zapečený“ offset): geometrie z jádra, žádná vazba k originálu, žádná kóta. Nejjednodušší; po změně originálu offset nesleduje.
2. **Nové entity + běžné vazby po segmentech:** úsečka `parallel` k originálu + kóta `pointLineDistance`, oblouk sdílí střed s originálem (soustředný) + vlastní kóta poloměru. Částečně asociativní, ale kót je tolik, kolik segmentů, a vzdálenost se mění po jednom.
3. **Asociativní vazba `offset`** (jako Onshape): jedna vazba „křivky B jsou odsazení křivek A o `d`“ s jednou kótou `d`. V řešiči planegcs složená z primitiv: úsečka → rovnoběžnost + vzdálenost bod–přímka se sdílenou hodnotou, oblouk/kružnice → společný střed + rozdíl poloměrů (`difference`). Spline asociativní být nemůže (ekvidistanta splinu není spline) → u splinu varianta 1. Největší rozsah (model, parse, edit, adaptér řešiče, glyf, kóta).
4. **Recept jako pole (M36):** offset jako entita s odvozenými křivkami. Ekvidistanta splinu ale potřebuje jádro (asynchronně) a kopie se neřeší řešičem – do synchronní kresby a `regionCurves` se nehodí.

Návrh: **3** pro úsečky, oblouky a kružnice, spline podle 1 – chování jako Onshape a jedna kóta; řešič má na to primitiva.

## Rozhodnutí

Pavel 2026-10-17 (volba v sezení stopy A): **možnost 3 – vazba `offset`**. K tomu: rohy offsetu ven **ostré** (prodloužení do průsečíku, `GeomAbs_Intersection`) a klik vybere **celý řetězec**. Propsáno do [[12-skicar#Offset (M35)]].
