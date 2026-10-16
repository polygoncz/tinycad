---
type: question
status: answered
area: "[[12-skicar]]"
decide_by: "[[M30-geometrie-skici-v-occt]]"
proposal: "Obrysy oblastí v artefaktu z jádra; náhled trimu a snapper v TS, zápis trimu z průsečíků jádra; sketcher volá jádro přes úzký port SketchGeometry v sketch (implementuje app); TS algoritmus oblastí se přesune do FakeKernel."
decision: "Podle návrhu (Pavel 2026-10-16). Oblasti z křížících se křivek ne v M30 (beze změny chování), otevřeno jako Q093 pro M33."
tags:
  - otazka
created: 2026-10-16
updated: 2026-10-16
---
# Q092 Hranice geometrie skici v TS a v OCCT

**Oblast:** [[12-skicar#Oblasti (profily)]], [[06-geometricke-jadro]], [[0028-geometrie-skici-v-jadre|ADR 0028]] · **Rozhodnout do:** [[M30-geometrie-skici-v-occt]]

## Otázka

[[0028-geometrie-skici-v-jadre|ADR 0028]] přesouvá topologii skici do OCCT, ale synchronní odpovědi pod kurzorem nechává v TS. Kde přesně vede hranice?

1. **Oblasti během editace:** `interaction` je bere z artefaktu poslední regenerace. Během tažení bodu se vyplnění opozdí – vadí to, nebo se při tažení vyplnění skryje?
2. **Trim pod kurzorem ([[M33-trim-extend-split|M33]]):** náhled úseku, který se odstraní, potřebuje průsečíky okamžitě. Načíst průsečíky z jádra jednou při aktivaci nástroje (a po každé změně), nebo je počítat v TS jen pro náhled?
3. **Snapper:** průsečíky křivek pro přichycení – TS (dnes), nebo předpočítané z jádra?
4. **Nové volání jádra mimo regeneraci:** nástroj skicáře volá jádro přímo (přes port v `interaction`), nebo jen přes regeneraci a artefakt? Dnes `interaction` jádro nezná.
5. `sketch/regions.ts`: zachovat jako orákulum v testech, nebo archivovat?

## Možnosti a návrh

Zjištění z kódu (2026-10-16): oblasti se dnes počítají dvakrát – v builderu skici (plochy) a v `artifactDrawing` (vyplnění a picking oblastí skic z regenerace). **Editovaná skica oblasti nekreslí vůbec**, takže obava z bodu 1 (zpoždění oblastí při tažení) odpadá.

Návrh:
1. Artefakt skici nese i **obrysy oblastí** z jádra; `artifactDrawing` je převezme místo vlastního výpočtu.
2. **Náhled trimu a snapper zůstávají v TS** (synchronní, pod kurzorem). Co se zapíše do dokumentu (body ořezu), počítá jádro.
3. Sketcher volá jádro přes **úzký port `SketchGeometry`** definovaný v `sketch` a implementovaný v `app` nad klientem jádra – stejně jako `ConstraintSolver` ([[0016-planegcs-resic-vazeb|ADR 0016]]). `interaction` a `sketcher` dál nezávisí na `kernel`.
4. Dnešní TS algoritmus oblastí (`sketch/regions.ts`) se **přesune do `FakeKernel`** jako jeho implementace `profileRegions`; testy oblastí se stanou kontraktovou sadou, která běží proti fake i OCCT.

## Rozhodnutí

Pavel 2026-10-16: **podle návrhu, body 1–4.** Kontrakt je v [[12-skicar#Geometrie skici v jádře (M30)]] a [[06-geometricke-jadro#Stav po M30]].

K tomu: OCCT by umělo křížící se křivky rozdělit a postavit z nich oblasti jako Onshape. Pavel: **v M30 beze změny chování** (křížení = žádné oblasti); oblasti z křížících se křivek otevírá [[Q093 Oblasti z křížících se křivek|Q093]] pro M33.
