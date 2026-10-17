---
type: question
status: open
area: "[[01-architektura]]"
decide_by: "[[M39-kostra-serveru]]"
proposal: "Vygenerovaný kód v novém modulu src/protocol (prstenec 3, generovaný při buildu, ne v gitu); adaptéry portů nad ním v novém modulu src/remote, který importuje jen app."
decision: ""
tags:
  - otazka
created: 2026-10-17
updated: 2026-10-17
---
# Q106 Moduly klienta pro gRPC

**Oblast:** [[01-architektura]], [[14-protokol]] · **Rozhodnout do:** [[M39-kostra-serveru|M39]]

## Otázka

Klient dostane kód vygenerovaný z `.proto` (protobuf-es, [[Q104 Nástroje pro kontrakt a C++ server|Q104]]) a adaptéry, které nad ním implementují porty (`SketchGeometry`, později sezení a read model). Do kterých modulů to patří a je vygenerovaný kód v gitu?

## Možnosti a návrh

**A. Dva nové moduly (návrh).** `src/protocol/` jen s vygenerovaným kódem (prstenec 3, [[0009-platformove-nezavisla-domena|ADR 0009]]) a `src/remote/` s adaptéry portů a klientem connect-web, který jako jediný importuje `protocol` a sám ho importuje jen `app`. Doména zprávy protobufu nikdy nevidí, převod na doménové typy je v adaptéru ([[Port a adaptér]]).
- \+ Stejný vzor jako `kernel-occt`: konkrétní technologie za portem, jeden modul ji zná.
- − Dva moduly navíc v tabulce závislostí a v `.dependency-cruiser.cjs`.

**B. Vše v `app`.**
- − `app` je kompoziční kořen, ne adaptér. Rostl by o tisíce řádků převodů.

**Vygenerovaný kód v gitu?** Ne (návrh): generuje se `buf generate` před `typecheck`, jinak se v revizích míchá ruční a generovaný kód. Rozhodne se spolu s modulem.

## Rozhodnutí

_(Až se rozhodne: vyplnit sem, nastavit `status: answered` a `decision`, rozhodnutí propsat do specifikace.)_
