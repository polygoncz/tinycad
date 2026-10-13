---
type: concept
aliases:
  - FeaturePlugin
code: "FeaturePlugin"
module: "plugin-api"
summary: "Balík schéma + builder + nástroje; jednotka rozšiřitelnosti."
related:
  - "[[Schéma featury]]"
  - "[[Builder featury]]"
  - "[[Nástroj]]"
tags:
  - pojem
created: 2026-10-12
updated: 2026-10-12
---
# Plugin featury

Jednotka rozšiřitelnosti: [[Schéma featury]] + [[Builder featury]] + nástroje (+ případně vlastní operace). [[Kompoziční kořen]] ho při startu rozdělí do registrů jednotlivých vrstev. Nová featura = nový plugin ve `src/features/<nazev>/` a jeden řádek registrace.

**V návrhu:** [[11-ui]], [[0004-data-oddelene-od-chovani]]
**Souvisí:** [[Schéma featury]], [[Builder featury]], [[Nástroj]]
