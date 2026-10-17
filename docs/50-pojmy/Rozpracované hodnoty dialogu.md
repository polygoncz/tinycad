---
type: concept
aliases:
  - Rozpracované hodnoty
  - Draft values
  - Dialog draft
code: "FeatureEditSession (draft)"
module: "interaction"
summary: "Kopie parametrů, kterou dialog featury drží od zápisu uživatele, dokud server nepřijme poslední odeslanou změnu; jediný lokální stav změn tenkého klienta."
related:
  - "[[Transakce]]"
  - "[[Read model]]"
  - "[[Featura]]"
  - "[[Manipulátor]]"
tags:
  - pojem
created: 2026-10-18
updated: 2026-10-18
---
# Rozpracované hodnoty dialogu

Hodnoty parametrů, které uživatel v dialogu featury zadal a server je ještě nepřijal. `FeatureEditSession` je drží od `setParam`/`setParams` (v `create` od `feature.add`) a `EditState.params` čte z nich, dokud server nepřijme **poslední odeslanou** změnu session; pak čte zase dokument, tedy [[Read model|read model]] odpovědi. Odmítnutá poslední změna je nechá do další přijaté změny nebo do konce session. Existují proto, že tenký klient ([[0031-tenky-klient-bez-handleru|ADR 0031]]) nic neaplikuje lokálně, ale dialog, [[Manipulátor|manipulátor]] i skicář čtou parametry hned po zápisu – bez kopie by druhá rychlá změna přepsala první. Nejsou to doména ani druhá implementace operací: vznikají jen z patche dialogu (`{ ...params, ...patch }`) a jsou to vstup uživatele. Pravidlo „poslední vyhrává“: odpověď na starší změnu rozpracované hodnoty nezahodí.

**V návrhu:** [[10-interakce#Rozpracované hodnoty a „poslední vyhrává“]], [[Rozhodnutí nativního jádra#Plán M52 – tenký klient|N164]], [[M52-tenky-klient]]
**Souvisí:** [[Transakce]], [[Read model]], [[Featura]]
