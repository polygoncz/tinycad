---
type: question
status: open
area: "[[04-operace-a-historie]]"
decide_by: "[[M11-dalsi-entity]]"
proposal: "Operace nesoucí parametry nesou i typeVersion; parseLogEntry je migruje stejně jako fromData"
decision: ""
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

_(Až se rozhodne: vyplnit sem, nastavit `status: answered` a `decision`, rozhodnutí propsat do specifikace. Zásadní rozhodnutí → nové ADR.)_
