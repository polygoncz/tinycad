---
type: question
status: answered
area: "[[14-protokol]]"
decide_by: "[[Roadmapa]]"
proposal: "Operace jako typovaný oneof zpráv, parametry featur jako google.protobuf.Struct; log v SQLite zůstává JSON operací ze spec 04; .proto ve server/proto/."
decision: "Typovaný oneof, params jako Struct, .proto je formát přenosu a log v SQLite zůstává JSON s v a upcast; soubory hned v server/proto/tinycad/v1, výklad ve spec 14."
tags:
  - otazka
created: 2026-10-17
updated: 2026-10-17
---
# Q101 Operace v kontraktu proto

**Oblast:** [[14-protokol]], [[04-operace-a-historie]] · **Rozhodnout do:** [[Roadmapa|plánování série nativního jádra]]

## Otázka

[[Operace]] jsou dnes JSON objekty `{ type, v, … }` a jejich verze řeší `upcast` při čtení logu ([[0005-operacni-log|ADR 0005]]). Jak budou vypadat v `.proto`? A kde budou soubory `.proto` ležet?

## Možnosti a návrh

**A. Typovaný `oneof` (návrh).** Každý typ operace má vlastní zprávu (`FeatureAdd`, `FeatureSetParams`…). Parametry featur zůstávají dynamické jako `google.protobuf.Struct`, jejich tvar určuje [[Schéma featury|schéma featury]].
- \+ Kontrakt je čitelný z `.proto`, přímý klient v C# nebo Pythonu ho vidí bez vaultu.
- \+ Překlep v poli je chyba překladu, ne chyba za běhu.
- − Server převádí zprávu na JSON operaci logu. Je to jedna funkce s testem.

**B. Operace jako JSON uvnitř zprávy** (`Operation { string json }`).
- \+ Žádný převod.
- − `.proto` je jen „trubka na JSON“ a typovou kontrolu ztratíme.

**Kde:** skutečné soubory v `server/proto/` hned (zkontroluje je `buf lint`), nebo jen bloky kódu ve vaultu.

## Rozhodnutí

**Varianta A a soubory hned (Pavel 2026-10-17, podle návrhu Clauda).**

- `.proto` je **formát přenosu, ne úložiště.** Log v SQLite zůstává JSON operací ze [[04-operace-a-historie|spec 04]] s `v` a `upcast`. Na drátě `v` není: klient vždy posílá aktuální verzi a vývoj zprávy řeší čísla polí protobufu.
- Soubory leží v `server/proto/tinycad/v1/` (balík `tinycad.v1`), výklad a důvody jsou ve [[14-protokol|spec 14]]. Zdrojem pravdy o syntaxi jsou soubory, o záměru spec.
