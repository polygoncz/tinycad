---
type: concept
aliases:
  - Feature
  - FeatureInstance
code: "FeatureInstance"
module: "document"
summary: "Jeden krok historie: typ, parametry, jméno. Čistá data."
related:
  - "[[Schéma featury]]"
  - "[[Builder featury]]"
  - "[[Plugin featury]]"
  - "[[Neměnná data]]"
tags:
  - pojem
created: 2026-10-12
updated: 2026-10-12
---
# Featura

Jeden krok parametrické historie (kvádr, extrude, fillet…). V dokumentu je to **čistý neměnný datový objekt**: `id`, `type`, `typeVersion`, `name`, `params`, `suppressed`. Žádné chování.

Chování typu featury je rozdělené: [[Schéma featury]] (data), [[Builder featury]] (geometrie), nástroje – spojené v [[Plugin featury|pluginu]].

**V návrhu:** [[03-dokument]], [[0004-data-oddelene-od-chovani]]
**Souvisí:** [[Schéma featury]], [[Builder featury]], [[Plugin featury]], [[Neměnná data]]
