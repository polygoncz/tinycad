---
type: question
status: answered
area: "[[14-protokol]]"
decide_by: "[[Roadmapa]]"
proposal: "Dokument je v paměti jádra jednou, každá karta má vlastní sezení; zapisovat smí jen sezení se zámkem pro zápis, ostatní čtou a sledují."
decision: "Sezení na kartu nad jedním běhovým dokumentem; zámek pro zápis má nejvýš jedno sezení (kopie doc-lock), ostatní jsou jen pro čtení; zámek se uvolní zavřením nebo timeoutem nečinnosti."
tags:
  - otazka
created: 2026-10-17
updated: 2026-10-17
---
# Q102 Sezení pro více karet

**Oblast:** [[14-protokol]], [[05-persistence]] · **Rozhodnout do:** [[Roadmapa|plánování série nativního jádra]]

## Otázka

[[Q094 Nativní jádro na serveru přes gRPC|Q094]] zavedla sezení nezávislé na spojení a [[Q097 Transakce a undo přes RPC|Q097]] do něj dala otevřenou [[Transakce|transakci]] a undo. Dnes v prohlížeči platí „jeden zapisovatel na dokument“: Web Lock v `app/doc-lock.ts`, další karta otevře dokument jen pro čtení ([[Q038 Jeden dokument ve dvou záložkách|Q038]]). Jak se to přenese na server?

## Možnosti a návrh

**A. Sezení na kartu a zámek pro zápis (návrh).** Dokument je v paměti jádra jednou (běhový dokument), každá karta má vlastní `session_id`. Měnit (Dispatch, transakce, undo) smí jen sezení se zámkem pro zápis, ostatní dostanou `READ_ONLY` a sledují `WatchSession`.
- \+ Přesná kopie dnešního chování, jen zámek drží server, ne prohlížeč.
- \+ Rozdělaná transakce jedné karty se do druhé karty nepromítá jako vlastní stav.

**B. Jedno sdílené sezení pro všechny karty.**
- − Dvě karty by si přebíraly transakci a undo. Pro jednoho uživatele zbytečně složité.

## Rozhodnutí

**Varianta A (Pavel 2026-10-17, podle návrhu Clauda).** Zámek dostane sezení, které dokument otevře jako první, a drží ho do `CloseSession` nebo do timeoutu nečinnosti (žádné RPC ani otevřený `WatchSession`). Timeout zahodí otevřenou transakci jako `Abort`. Sezení jen pro čtení zůstává jen pro čtení, dokud se neotevře znovu, stejně jako dnes. Přebrání zámku za běhu je mimo rozsah.
