---
type: concept
aliases:
  - AppSession
  - Composition root
code: "AppSession"
module: "app"
summary: "Jediné místo, kde se moduly propojí a vytvoří konkrétní implementace."
related:
  - "[[Port a adaptér]]"
  - "[[Plugin featury]]"
tags:
  - pojem
created: 2026-10-12
updated: 2026-10-12
---
# Kompoziční kořen

Jediné místo aplikace, které zná konkrétní implementace ([[Port a adaptér|adaptéry]]), registruje [[Plugin featury|pluginy]] a propojuje události (změna dokumentu → regenerace → vykreslení). Ostatní moduly dostávají závislosti v konstruktoru – DI bez frameworku. Pro UI slouží jako fasáda.

**V návrhu:** [[11-ui]], [[01-architektura]]
**Souvisí:** [[Port a adaptér]], [[Plugin featury]]
