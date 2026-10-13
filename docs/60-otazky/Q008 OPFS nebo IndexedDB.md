---
type: question
status: open
area: "[[05-persistence]]"
decide_by: "[[M04-persistence]]"
proposal: "IndexedDB"
decision: ""
tags:
  - otazka
created: 2026-10-12
updated: 2026-10-12
---
# Q008 OPFS nebo IndexedDB

**Oblast:** [[05-persistence]] · **Rozhodnout do:** [[M04-persistence]]

## Otázka

Ukládat do IndexedDB, nebo do Origin Private File System (OPFS)?

## Možnosti a návrh

IndexedDB stačí pro log a snapshoty. OPFS dává smysl až pro velká binární data (viz [[Q007 Cache geometrie]]).

## Rozhodnutí

_(Až se rozhodne: vyplnit sem, nastavit `status: answered` a `decision`, rozhodnutí propsat do [[05-persistence]]. Zásadní rozhodnutí → nové ADR.)_
