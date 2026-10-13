---
type: concept
aliases:
  - FeatureSchema
code: "FeatureSchema"
module: "document"
summary: "Datový popis typu featury: parametry, výchozí hodnoty, validace, migrace."
related:
  - "[[Featura]]"
  - "[[Parametr featury]]"
  - "[[Plugin featury]]"
tags:
  - pojem
created: 2026-10-12
updated: 2026-10-12
---
# Schéma featury

Datová část typu [[Featura|featury]]: verze, popis parametrů ([[Parametr featury|ParamSpec]]), výchozí hodnoty, validace a migrace starších verzí. Registruje se do `FeatureSchemaRegistry`. Dokument díky tomu jde načíst a migrovat bez geometrického jádra.

**V návrhu:** [[03-dokument]], [[0004-data-oddelene-od-chovani]]
**Souvisí:** [[Featura]], [[Parametr featury]], [[Plugin featury]]
