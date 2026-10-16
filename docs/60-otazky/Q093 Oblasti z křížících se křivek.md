---
type: question
status: answered
area: "[[12-skicar]]"
decide_by: "[[M33-trim-extend-split]]"
proposal: "Beze změny: křížení = žádné oblasti; skicář vyznačí body křížení, aby uživatel věděl, co ořezat (trim M33). Oblasti z kusů křivek případně později vlastním milníkem."
decision: "Podle návrhu (Pavel 2026-10-16): křížení dál bez oblastí, body křížení vyznačené ve skicáři."
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

1. **Beze změny + body křížení (návrh).** `crossing` dál znamená žádné oblasti. Editovaná skica vyznačí body křížení (z průsečíků, které skicář od M33 drží kvůli trimu), takže uživatel ví, co ořezat. Jména oblastí a ploch zůstávají z id celých křivek, tedy stabilní. Žádná změna portu `profileRegions`.
2. **Oblasti z kusů křivek** (Onshape, Fusion). Kandidát v OCCT je `BRepAlgoAPI_Splitter` (prototyp M30: dělí sám, jména kusů dá historie). Jméno oblasti by neslo kusy, např. id křivky + id křivek na koncích kusu; u dvou kružnic mají oba kusy stejné sousedy, takže by bylo potřeba ještě pořadí. Nový průsečík jména mění a reference vysunutí (`SketchRegionRef`) a `face:side:<id>` se rozbijí. Výrazně větší M33.

Návrh 1: s trimem v M33 je cesta „oříznout a pak vysunout“ krátká, jména zůstanou stabilní a možnost 2 jde přidat později beze změny dat (jen nové jméno oblasti s kusy).

## Rozhodnutí

Pavel 2026-10-16 (volba v sezení stopy A): **možnost 1** – „Beze změny + body křížení“. Propsáno do [[12-skicar#Trim, extend, split (M33)]].
