---
type: moc
status: active
aliases:
  - Home
  - Domu
tags:
  - moc
created: 2026-10-12
updated: 2026-10-12
---
# tinycad – Domů

Second brain výukového projektu **tinycad**: webová parametrická CAD aplikace inspirovaná Onshape (jen Part Studio). Tahle stránka je vstupní bod. Ručně udržovaná mapa nahoře, automatické přehledy (Bases) dole.

## Kde začít

1. [[Vize|Vize a rozsah]]: co stavíme a co ne.
2. [[01-architektura|Architektura]]: vrstvy, moduly, pravidla závislostí, tok dat.
3. [[Roadmapa]]: pořadí práce, milníky odspodu nahoru.
4. [[Konvence vaultu]]: jak je vault uspořádaný a jak ho vést (platí pro Pavla i Clauda).

## Mapa architektury

Odspodu nahoru, tak jak se staví. U každé vrstvy je napsáno, proč existuje.

- [[02-core|core]]: sdílené základy (ID, události, RPC pro workery). Nesmí na ničem záviset.
- [[03-dokument|document]]: [[Dokument|dokument]] jako recept z [[Featura|featur]]. Žádná geometrie.
- [[04-operace-a-historie|ops]]: jediná cesta ke změně dokumentu, tedy [[Operace|operace]], [[Operační log|log]] a [[Undo a redo|undo/redo]].
- [[05-persistence|persistence]]: log a [[Snapshot|snapshoty]] v IndexedDB.
- [[06-geometricke-jadro|kernel]]: [[Geometrické jádro|jádro]] za [[Port a adaptér|portem]], OCCT ve WASM ve workeru.
- [[07-regenerace|regen]]: [[Regenerace|přehrání historie]] s cache podle [[Neměnná data|identity]].
- [[08-topologicke-pojmenovani|Topologické pojmenování]]: stabilní odkazy na plochy a hrany, nejtěžší část.
- [[09-vykreslovani|render]]: [[Viewport|Three.js viewport]] a picking.
- [[10-interakce|interaction]]: [[Výběr|výběr]], [[Nástroj|nástroje]], [[Akce|akce]] a dialog featury nad [[Transakce|transakcí]].
- [[11-ui|plugin-api, app, ui]]: [[Plugin featury|pluginy]], [[Kompoziční kořen|kompoziční kořen]] a Vue.
- [[12-skicar|Skicář]]: 2D skica s vazbami.
- [[13-testovani|Testování]]: jak je to všechno ověřené.

Další rozcestníky: [[Glosář]] (všechny pojmy), [[Rozhodnutí]] (ADR).

## Milníky

![[milniky.base#Přehled]]

## Otevřené otázky

![[otazky.base#Otevřené]]

## Deník

Co se kdy změnilo a proč. Jeden záznam na pracovní den.

![[denik.base#Poslední]]

## Poznatky

Co jsem se naučil, nezávisle na tinycad (rešerše, principy, srovnání).

![[poznatky.base#Poznatky]]

## Inbox

Rychlé nápady čekající na roztřídění (viz [[Konvence vaultu#Inbox a revize|revize]]).

![[inbox.base]]
