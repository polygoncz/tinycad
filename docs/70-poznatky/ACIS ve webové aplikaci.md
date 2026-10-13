---
type: insight
status: seed
aliases:
  - ACIS na webu
topics:
  - geometrické jádro
  - licence
sources:
  - https://en.wikipedia.org/wiki/ACIS
  - https://www.intellicad.org/hubfs/Agreements/ITC_and_Spatial_License_Agreements_2015_12_14.pdf
  - https://sim4life.swiss/device-design-tools
  - https://www.digitalengineering247.com/article/machine-research-launches-application/additive-manufacturing
tags:
  - poznatek
created: 2026-10-12
updated: 2026-10-12
---
# ACIS ve webové aplikaci

**Shrnutí:** ACIS ve webu technicky jde, ale typicky běží na serveru, ne v prohlížeči, a licence se sjednává individuálně (procenta z tržeb), takže pro osobní výukový projekt nepřichází v úvahu.

## Podrobnosti

- ACIS (3D ACIS Modeler) vyvíjí Spatial Corporation, proprietární software.
- Licence se sjednává se Spatialem individuálně, ne jako npm balíček. Zveřejněná smlouva IntelliCAD konsorcia ukazuje poplatky jako procenta z ročních tržeb; i přes konsorcium platí člen 2 500 USD ročně. Pro jednotlivce nanejvýš časově omezená evaluační licence.
- Webové aplikace s ACIS dělí práci na frontend v prohlížeči a výpočetní backend: Sim4Life.web (modelování nad ACIS, výpočty na serveru), Machine Research (cloudová aplikace nad 3D InterOp a 3D ACIS).
- Veřejně dostupný build ACIS do WebAssembly není známý.

## Jak to využívá tinycad

Potvrzuje volbu OCCT ve WASM ([[0002-occt-wasm-ve-workeru]]). Architektura „jádro na serveru, prohlížeč jen vykresluje“ (jako Onshape s Parasolidem) jde díky [[Port a adaptér|portu]] později vyzkoušet jako alternativní adaptér. Viz [[Geometrická jádra – přehled]].

## Zdroje

- [ACIS – Wikipedia](https://en.wikipedia.org/wiki/ACIS)
- [ITC and Spatial License Agreements (IntelliCAD)](https://www.intellicad.org/hubfs/Agreements/ITC_and_Spatial_License_Agreements_2015_12_14.pdf)
- [Sim4Life – device design tools](https://sim4life.swiss/device-design-tools)
- [Machine Research Launches Application – Digital Engineering 24/7](https://www.digitalengineering247.com/article/machine-research-launches-application/additive-manufacturing)
