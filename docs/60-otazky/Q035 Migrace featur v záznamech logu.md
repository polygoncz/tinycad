---
type: question
status: answered
area: "[[04-operace-a-historie]]"
decide_by: "[[M11-dalsi-entity]]"
proposal: "Operace nesoucí parametry nesou i typeVersion; parseLogEntry je migruje stejně jako fromData"
decision: "setParams nese typeVersion (v: 2); migrace při apply přes schémata v registru handlerů"
tags:
  - otazka
created: 2026-10-13
updated: 2026-10-13
---
# Q035 Migrace featur v záznamech logu

**Oblast:** [[04-operace-a-historie]] · **Rozhodnout do:** [[M11-dalsi-entity]]

## Otázka

`fromData` migruje featury snapshotu na aktuální verzi [[Schéma featury|schématu]] (`typeVersion` → `migrate`). Záznamy [[Operační log|logu]] ale featury a parametry nesou také: `feature.add` celou `FeatureInstance` (s `typeVersion`), `feature.setParams` jen `params` **bez verze**. Když schéma boxu přejde na verzi 2, přehrání starého logu vloží featuru verze 1, případně nastaví parametry ve starém tvaru. Kdo a jak je má migrovat? Operace se mění upcastem (verze operace), parametry migrací schématu (verze featury). Jsou to dvě nezávislé verze.

## Možnosti a návrh

1. **`feature.setParams` nese `typeVersion`.** `parseLogEntry` (nebo handler při `validate`) migruje featury a parametry v operacích přes `FeatureSchemaRegistry`, stejně jako `fromData`.
   - \+ Log je po načtení celý v aktuálním tvaru, přehrání je jednoduché.
   - − `ops` potřebuje přístup ke schématům při načítání a mění se tvar operace (`v: 2` u `setParams`).
2. **Migrace při `apply`.** Handler zjistí verzi featury v dokumentu a parametry převede.
   - − `setParams` verzi nemá, takže by se musela odvodit z featury v dokumentu, a to může být špatně.
3. **Log před změnou schématu „zmrazit“.** Při první změně verze schématu se uloží snapshot a starší záznamy se už nepřehrávají (jen undo historie do toho bodu).
   - \+ Žádná migrace operací.
   - − Undo přes hranici změny schématu nefunguje.

Návrh: **1**. Dokud má každé schéma `version: 1`, problém nenastane. M4 ho jen popíše jako známé omezení. Rozhodnout je potřeba nejpozději ve chvíli, kdy první schéma přejde na verzi 2, tedy v [[M11-dalsi-entity|M11]] nebo dřív.

## Rozhodnutí

2026-10-14 (Pavel, plán [[M10.1-zpevneni-kostry|M10.1]]): **spojení možností 1 a 2.** `feature.setParams` nese `typeVersion` a má verzi operace 2; `upcast` z verze 1 doplní `typeVersion: 1` (v době verze 1 měla všechna schémata `version: 1`, od teď platí invariant: verze operace nesoucí data featury se zvedá dřív, než první schéma opustí verzi 1). Migrace parametrů běží při `apply` handlerů `feature.add` a `feature.setParams` přes `migrateFeatureData` z `document`; registr handlerů dostane schémata (`createOpHandlerRegistry({ schemas })`). `apply` zná typ featury i u `setParams`, `parseLogEntry` zůstává bez schémat. Propsáno do [[04-operace-a-historie#Handler]], [[03-dokument#Serializace]] a [[05-persistence#Načtení dokumentu]].

> [!note] Návrh z plánu M10.1 (2026-10-13)
> [[M10.1-zpevneni-kostry|M10.1]], úkol Ú2, spojuje možnosti 1 a 2: `feature.setParams` nese `typeVersion` (verze operace 2, `upcast` z 1 doplní `typeVersion: 1`, protože v době verze 1 měla všechna schémata `version: 1`) a migrace běží při `apply` přes `migrateFeatureData` z `document` (`createOpHandlerRegistry({ schemas })`). `apply` zná typ featury i u `setParams`, `parseLogEntry` zůstává bez schémat a bez stavu. Rozhodnout při startu M10.1.
