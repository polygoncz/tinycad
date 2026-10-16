---
type: adr
status: accepted
number: 28
aliases:
  - ADR 0028
  - Geometrie skici v jádře
date: 2026-10-16
related:
  - "[[0017-modul-sketch-a-skicar]]"
  - "[[12-skicar]]"
  - "[[06-geometricke-jadro]]"
  - "[[Q088 Geometrie skici v TypeScriptu nebo v OCCT]]"
  - "[[Q092 Hranice geometrie skici v TS a v OCCT]]"
  - "[[M30-geometrie-skici-v-occt]]"
supersedes:
tags:
  - adr
created: 2026-10-16
updated: 2026-10-16
---
# 0028 – Geometrie skici v jádře OCCT

- **Stav:** Přijato (`status: accepted`, Pavel 2026-10-16). Kontrakt portu se upřesní při startu [[M30-geometrie-skici-v-occt|M30]].
- **Datum:** 2026-10-16
- **Souvisí:** [[0017-modul-sketch-a-skicar|ADR 0017]] (bod 4 a důsledek „dvě reprezentace“), [[Q088 Geometrie skici v TypeScriptu nebo v OCCT|Q088]], [[12-skicar#Oblasti (profily)]], [[06-geometricke-jadro]]

## Kontext

Podle [[0017-modul-sketch-a-skicar|ADR 0017]] počítá skicář oblasti a křížení sám v TypeScriptu (`computeRegions`) a jádro z hotových smyček jen staví plochy. O téže topologii tak rozhodují dva geometrické motory s různými tolerancemi. U úseček a oblouků to drží test obsahu ploch, u splinu (od [[M29-spliny|M29]]) už TS pracuje s tessellací.

Další série skicáře ([[Roadmapa#Rozšíření skicáře II (M30–M37)]]) přidává operace, které geometrii mění: trim, extend, split, zaoblení a sražení ve skice, offset. Ty potřebují přesné průsečíky a ekvidistanty všech druhů křivek včetně splinu. Kdyby zůstaly v TS, duplicita s OCCT by rostla s každou operací. Pavel ([[Q088 Geometrie skici v TypeScriptu nebo v OCCT#Znovuotevření 2026-10-16|Q088]]) zvolil přesun celé geometrie skici do jádra.

## Rozhodnutí

1. **Topologii skici počítá jádro.** Oblasti (smyčky, díry, jména z id křivek), detekce křížení, průsečíky křivek a offset jsou operace portu `GeometryKernel` (nové `SketchOps`, název upřesní M30) implementované v `kernel-occt` (`Geom2dAPI_InterCurveCurve`, `BRepAlgoAPI`/`BOPAlgo` pro oblasti, `BRepOffsetAPI_MakeOffset` / `Geom2d_OffsetCurve` pro offset).
2. **Vstup a výstup jsou data, ne handle.** Port dostane křivky `Curve2` s id entit a vrátí oblasti s týmiž jmény (id hraničních křivek) a plochy jako `ShapeHandle`. Jména oblastí se nemění, takže reference `SketchRegionRef` a topologická jména `face:side:<id>` zůstanou platné.
3. **Kdo z čeho bere oblasti:** builder skici z jádra; `interaction` pro vyplnění a picking oblastí z **artefaktu** poslední regenerace, ne z vlastního výpočtu.
4. **Data skici dál nesou vyřešené souřadnice** a operace, které geometrii mění (trim, offset…), zapíšou výsledek jako nové entity skici přes `ops`. Jádro je pomocník pro výpočet, nikoli úložiště skici.
5. **TS geometrie zůstává jen pro synchronní odpovědi pod kurzorem:** snapper, náhledy nástrojů, odhady pro řešič. Co se zapíše do dokumentu, počítá jádro. Přesnou hranici a chování během tažení (oblasti se na chvíli opozdí za kresbou) určí [[Q092 Hranice geometrie skici v TS a v OCCT|Q092]].
6. `sketch/regions.ts` po M30 přejde do role testovacího orákula nebo se přesune do archivu, rozhodne M30.

## Zvažované alternativy

- **Nechat vše v TS** (původní rozhodnutí Q088) – rychlé a synchronní, ale trim, offset a zaoblení splinu by vyžadovaly vlastní numerickou geometrii a duplicita s OCCT by rostla.
- **OCCT jen pro nové operace, oblasti v TS** – menší zásah, ale přesně tam, kde se oblasti a průsečíky potkávají (trim v průsečíku, který TS vidí jinak než OCCT), by riziko neshody zůstalo.

## Důsledky

- (+) Jedna geometrie pro topologii skici; spline je v oblastech, průsečících i offsetu přesný.
- (+) Pavel staví na knihovně, kterou zná z desktopu (Geom2d, BOPAlgo).
- (−) Výpočet oblastí je asynchronní (worker); během tažení bodu se vyplnění oblastí opozdí za kresbou čar.
- (−) Testy oblastí potřebují OCCT (kontraktová sada jádra a `FakeKernel` s jednoduchou implementací), přestávají být čistě v Node bez WASM.
- (−) Změna sahá do `kernel`, `kernel-occt`, `features/sketch`, `interaction`, `sketcher` a `app` – proto samostatný milník bez nových funkcí.
- Bod 4 a důsledek „dvě reprezentace“ z [[0017-modul-sketch-a-skicar|ADR 0017]] tímto ADR přestávají platit; zbytek ADR 0017 platí dál.

## Doplněk 2026-10-16: jak to dopadlo v M30

- Bod 1: oblasti nepoužívají `BOPAlgo` (předpřipravený build ho neváže) ani `BRepAlgoAPI_Splitter` (nepozná samoprůsečík splinu, liší se v krajních případech). Implementace v `kernel-occt/regions.ts` je algoritmus kontraktu s průsečíky z `Geom2dAPI_InterCurveCurve` a plochou z Greenovy věty – viz [[06-geometricke-jadro#Oblasti skici v adaptéru (M30)]]. Splitter zůstává kandidátem pro [[Q093 Oblasti z křížících se křivek|Q093]].
- Bod 6: `sketch/regions.ts` se přesunul do `kernel/fake-regions.ts` jako implementace `FakeKernel` (ne do archivu); jeho testy jsou kontraktová sada jádra, která běží proti fake i OCCT.
- Důsledek „testy oblastí potřebují OCCT“ platí jen pro adaptér: vyšší vrstvy testují oblasti nad `FakeKernel` v Node bez WASM.
