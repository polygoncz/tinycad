---
type: question
status: answered
area: "[[11-ui]]"
decide_by: "[[M06-regenerace]]"
proposal: "registerPlugin je veřejné API plugin-api, ověří shodu typu schématu a builderu; kontrola všech pluginů v app"
decision: "registerPlugin v plugin-api, invariant z konstrukce, plná kontrola v app (M10)"
tags:
  - otazka
created: 2026-10-13
updated: 2026-10-13
---
# Q047 Registrace pluginu a úplnost registrů

**Oblast:** [[11-ui]] · **Rozhodnout do:** [[M06-regenerace]]

## Otázka

Milník chce test „každý registrovaný typ má schéma i builder“. `plugin-api` ale nesmí importovat `features/*` ([[01-architektura]]), takže nezná seznam všech [[Plugin featury|pluginů]]. Kde se invariant zajistí?

## Možnosti a návrh

1. **`registerPlugin(plugin, { schemas, builders })` jako veřejné API `plugin-api`:** ověří `schema.type === builder.type` a zaregistruje obojí. Invariant pak platí z konstrukce, test ověří odmítnutí nesouhlasných typů. Kontrola všech pluginů se přesune do `app` (M10).
   - \+ Stejnou funkci použije `app` i testy.
2. **Pomocník jen v `testing.ts`.**
   - − `app` by registroval jinak než testy.

Návrh: **1**.

## Rozhodnutí

2026-10-13: Pavel souhlasí s návrhem (varianta 1). Propsáno do [[11-ui]].
