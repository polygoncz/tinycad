---
type: question
status: open
area: "[[12-skicar]]"
decide_by: "[[M33-trim-extend-split]]"
proposal: ""
decision: ""
tags:
  - otazka
created: 2026-10-16
updated: 2026-10-16
---
# Q093 Oblasti z křížících se křivek

**Oblast:** [[12-skicar#Oblasti (profily)]], [[08-topologicke-pojmenovani]], [[0028-geometrie-skici-v-jadre|ADR 0028]] · **Rozhodnout do:** [[M33-trim-extend-split]]

## Otázka

Skica, ve které se křivky kříží, dnes nedá žádné oblasti (`crossing: true`). Onshape a Fusion v takové skice nabídnou všechny oblasti, které křivky ohraničují (čočka a dva srpky ze dvou kružnic). Po [[M30-geometrie-skici-v-occt|M30]] to OCCT umí (`BOPAlgo_Builder` křivky rozdělí v průsečících). Pavel 2026-10-16: v M30 beze změny, rozhodnout s trimem.

Problém je **jméno oblasti**. Dnes je to seznam id hraničních křivek. U dvou kružnic mají čočka i oba srpky stejný soubor křivek (obě kružnice), takže by měly stejné jméno. Jméno by muselo nést **části** křivek – např. id křivky a pořadí úseku mezi průsečíky podél ní – a to se mění, když přibude další průsečík. Na jménech oblastí stojí reference vysunutí (`SketchRegionRef`) a jména bočních ploch `face:side:<id>` ([[08-topologicke-pojmenovani]]).

## Možnosti a návrh

_(Doplnit při startu M33.)_

## Rozhodnutí
