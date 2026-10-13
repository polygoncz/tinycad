---
type: question
status: open
area: "[[02-core]]"
decide_by: "[[M01-core]]"
proposal: "Náhodné krátké (base62)"
decision: ""
tags:
  - otazka
created: 2026-10-12
updated: 2026-10-12
---
# Q002 Formát ID

**Oblast:** [[02-core]] · **Rozhodnout do:** [[M01-core]]

## Otázka

Jaký formát mají mít generovaná ID (featury, entity skici, dokumenty)?

## Možnosti a návrh

- Náhodné krátké ID (nanoid-like, ~10 znaků base62) – čitelné v ladění.
- `uuidv7` – seřaditelné podle času, delší.

Návrh: náhodné krátké.

## Rozhodnutí

_(Až se rozhodne: vyplnit sem, nastavit `status: answered` a `decision`, rozhodnutí propsat do [[02-core]]. Zásadní rozhodnutí → nové ADR.)_
