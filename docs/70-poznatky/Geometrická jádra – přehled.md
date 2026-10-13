---
type: insight
status: seed
aliases:
  - Geometricka jadra
  - CAD kernels
topics:
  - geometrické jádro
  - B-rep
sources: []
tags:
  - poznatek
created: 2026-10-12
updated: 2026-10-12
---
# Geometrická jádra – přehled

**Shrnutí:** pro přesný parametrický CAD v prohlížeči (fillety, booleany, STEP) je v open-source světě jedinou zralou volbou OpenCascade; komerční jádra nejsou pro jednotlivce dostupná a ostatní open-source projekty jsou kompromis.

## Podrobnosti

| Jádro | Typ | Licence | Poznámka |
|---|---|---|---|
| **Parasolid** (Siemens) | B-rep | komerční | Onshape, SolidWorks, NX. Pro jednotlivce nedostupné. |
| **ACIS** (Spatial) | B-rep | komerční | Viz [[ACIS ve webové aplikaci]]. |
| **C3D** | B-rep | komerční | Podobně nedostupné. |
| **OpenCascade (OCCT)** | B-rep | LGPL | Zralé, existuje ve WASM. Volba pro tinycad. |
| **Truck** (Rust) | B-rep, NURBS | open-source | Čistší moderní návrh, kompiluje se do WASM, ale slabé fillety a robustnost booleanů. |
| **Fornjot** (Rust) | B-rep | open-source | Spíš výzkumný experiment. |
| **Manifold** (C++/WASM) | síť trojúhelníků | open-source | Extrémně rychlé a robustní booleany (OpenSCAD), ale žádné přesné fillety, STEP ani pojem „plocha“. |
| **SolveSpace** | vlastní malé NURBS jádro + řešič vazeb | GPL | Čitelné, omezené. |
| JSCAD, three-bvh-csg | mesh CSG v JS | open-source | Pro parametrický CAD nevhodné. |

Vedlejší výuková cesta: napsat si vlastní mini B-rep jen pro rovinné plochy (extrude polygonů + booleany) a porovnat s OCCT – naučí víc o topologii než samotné používání jádra.

## Jak to využívá tinycad

- [[0002-occt-wasm-ve-workeru]] – volba OCCT ve WASM za portem.
- [[Q012 Volba WASM buildu OCCT]] – který build.
- [[Geometrické jádro]]

## Zdroje

- Konverzace s Claudem 2026-10-12 (obecná znalost, neověřeno rešerší – při rozhodování v M7 ověřit aktuální stav projektů).
