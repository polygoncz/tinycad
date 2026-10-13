---
type: concept
aliases:
  - FeatureBuilder
code: "FeatureBuilder"
module: "regen"
summary: "Chování featury: z parametrů a vstupního stavu spočítá geometrii."
related:
  - "[[Regenerace]]"
  - "[[Stav regenerace]]"
  - "[[Plugin featury]]"
tags:
  - pojem
created: 2026-10-12
updated: 2026-10-12
---
# Builder featury

Objekt, který z parametrů [[Featura|featury]] a vstupního [[Stav regenerace|stavu regenerace]] spočítá nový stav pomocí [[Geometrické jádro|jádra]]. Nesmí mutovat vstup ani uvolňovat handle. Parametry dostává už zvalidované.

**V návrhu:** [[07-regenerace]], [[0004-data-oddelene-od-chovani]]
**Souvisí:** [[Regenerace]], [[Stav regenerace]], [[Plugin featury]]
