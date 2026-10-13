---
type: concept
aliases:
  - Body
code: "Body / BodyId"
module: "regen"
summary: "Jedno pevné těleso ve stavu regenerace se stabilním BodyId."
related:
  - "[[Handle tvaru]]"
  - "[[Stav regenerace]]"
tags:
  - pojem
created: 2026-10-12
updated: 2026-10-12
---
# Těleso

Jedno pevné těleso ve [[Stav regenerace|stavu regenerace]]. Má stabilní `BodyId` (např. `<featureId>/body`), [[Handle tvaru|handle]] na tvar v jádře a tabulku [[Topologické pojmenování|topologických jmen]]. Featury se na tělesa odkazují přes `BodyRef`.

**V návrhu:** [[07-regenerace]], [[03-dokument]]
**Souvisí:** [[Handle tvaru]], [[Stav regenerace]]

> [!note] Od M10.1 ([[0015-artefakty-a-identita-telesa|ADR 0015]])
> Těleso je jeden druh *artefaktu* (`kind: 'body'`) v mapě `RegenState.artifacts`. Identita je rodokmen: `origin` je featura, jejíž builder id razil (`bodyId(origin, n)` z `document`), `lastModifiedBy` poslední featura, která tělesu dala nový tvar. Featura, která těleso mění, zachová `id`, `origin` i `names`.
