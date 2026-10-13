---
type: question
status: open
area: "[[10-interakce]]"
decide_by: "[[M09-interakce]]"
proposal: "Dočasný posun jako Onshape"
decision: ""
tags:
  - otazka
created: 2026-10-12
updated: 2026-10-12
---
# Q018 Rollback bar při editaci starší featury

**Oblast:** [[10-interakce]] · **Rozhodnout do:** [[M09-interakce]]

## Otázka

Co se stane s [[Rollback bar|rollback barem]], když uživatel edituje featuru, která je před ním nebo za ním?

## Možnosti a návrh

Onshape při editaci featury dočasně posune rollback bar za ni. Návrh: `edit()` uloží původní pozici a v [[Transakce|transakci]] ji dočasně posune; po commitu/cancelu vrátí.

## Rozhodnutí

_(Až se rozhodne: vyplnit sem, nastavit `status: answered` a `decision`, rozhodnutí propsat do [[10-interakce]]. Zásadní rozhodnutí → nové ADR.)_
