---
type: question
status: answered
area: "[[02-core]]"
decide_by: "[[M01-core]]"
proposal: "Náhodné krátké (base62)"
decision: "Náhodné 10 znaků base62"
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

2026-10-13: **náhodné krátké ID, 10 znaků base62** (abeceda `0-9A-Za-z`). 62¹⁰ ≈ 8·10¹⁷ kombinací stačí s rezervou, ID je čitelné v ladění. Řazení podle času nepotřebujeme, pořadí drží [[Operační log|operační log]]. Zdroj náhody se do generátoru předává zvenku, viz [[Q022 Platformové typy v core|Q022]]. Propsáno do [[02-core]].
