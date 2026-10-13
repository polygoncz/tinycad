---
type: concept
aliases:
  - Sketch
  - Skici
  - Skicář
code: "SketchArtifact / SketchSession / SKETCH_FEATURE_TYPE"
module: "sketch"
summary: "2D geometrie s vazbami na rovině; featura, která nevytváří těleso, ale profily (oblasti) pro Extrude."
related:
  - "[[Featura]]"
  - "[[Artefakt]]"
  - "[[Řešič vazeb]]"
tags:
  - pojem
created: 2026-10-14
updated: 2026-10-14
---
# Skica

[[Featura]] typu `sketch`: body, úsečky, kružnice a oblouky na rovině spolu s vazbami a kótami. Těleso nevytváří; výsledkem regenerace je [[Artefakt|artefakt]] druhu `sketch` s rovinou, vyřešenou geometrií a plochami uzavřených **oblastí** (profilů), na které se odkazuje Extrude. Souřadnice v parametrech jsou už vyřešené ([[Řešič vazeb]] běží jen při editaci), takže regenerace řešič nevolá a přehrání logu je deterministické. Editace probíhá v **režimu skicáře** (`SketchSession` v `interaction`): jiná lišta nástrojů, kamera kolmo na rovinu, celá editace je jedna transakce a v logu jeden záznam.

**V návrhu:** [[12-skicar]], [[0017-modul-sketch-a-skicar]]
**Souvisí:** [[Řešič vazeb]], [[Artefakt]], [[Transakce]]
