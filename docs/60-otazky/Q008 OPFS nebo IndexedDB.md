---
type: question
status: answered
area: "[[05-persistence]]"
decide_by: "[[M04-persistence]]"
proposal: "IndexedDB"
decision: "IndexedDB"
tags:
  - otazka
created: 2026-10-12
updated: 2026-10-13
---
# Q008 OPFS nebo IndexedDB

**Oblast:** [[05-persistence]] · **Rozhodnout do:** [[M04-persistence]]

## Otázka

Ukládat do IndexedDB, nebo do Origin Private File System (OPFS)?

## Možnosti a návrh

IndexedDB stačí pro log a snapshoty. OPFS dává smysl až pro velká binární data (viz [[Q007 Cache geometrie]]).

## Rozhodnutí

2026-10-13: **IndexedDB.** Log a snapshoty jsou malé strukturované záznamy s klíčem, transakce přes více object stores dávají atomický zápis dávky. OPFS se vrátí na stůl až s cache geometrie ([[Q007 Cache geometrie|Q007]]). Nové ADR není potřeba, technologii už předpokládá [[0005-operacni-log|ADR 0005]]. Propsáno do [[05-persistence]].
