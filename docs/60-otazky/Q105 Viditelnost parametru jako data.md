---
type: question
status: answered
area: "[[14-protokol]]"
decide_by: "[[Roadmapa]]"
proposal: "visibleWhen jako deklarativní podmínka nad jedním parametrem (equals_any, equals_none, less_than), kterou vyhodnocuje klient i server."
decision: "Deklarativní podmínka VisibleWhen { param, equals_any | equals_none | less_than } ve FeatureTypeDescriptor; pokryje všech sedm dnešních predikátů."
tags:
  - otazka
created: 2026-10-17
updated: 2026-10-17
---
# Q105 Viditelnost parametru jako data

**Oblast:** [[14-protokol]], [[03-dokument]], [[Q098 Schéma featur v klientovi|Q098]] · **Rozhodnout do:** [[Roadmapa|plánování série nativního jádra]]

## Otázka

[[Q098 Schéma featur v klientovi|Q098]] poslala deklarativní část [[Schéma featury|schématu]] klientovi jako data. `ParamSpec.visibleWhen` je ale dnes **funkce** nad neověřenými parametry (`p => p.operation !== 'new'`). Funkce přes síť neprojde. Jak ji vyjádřit?

Dnešní predikáty (7): Extrude `operation ≠ 'new'`, `endType ≠ 'upToFace'`, `endType = 'upToFace'`, `endType = 'blind'`; Revolve `operation ≠ 'new'`, `angle < 2π − 1e-9`; Transform `pivot = 'point'`.

## Možnosti a návrh

**A. Deklarativní podmínka (návrh).** Parametr a test: `equals_any`, `equals_none`, `less_than`. Klient i server vyhodnocují tatáž data.
- \+ Pokryje všechny dnešní případy, dialog reaguje hned bez cesty na server.
- − Nový druh podmínky = změna kontraktu. Je to záměrně malý jazyk.

**B. Server posílá vypočtenou viditelnost v read modelu.**
- − Pole dialogu by se objevilo až po odpovědi serveru.

## Rozhodnutí

**Varianta A (Pavel 2026-10-17, podle návrhu Clauda).** Zpráva `VisibleWhen` v `server/proto/tinycad/v1/schema.proto`. Hodnota jiného typu, než test čeká (řetězec u `less_than`), znamená „skryto“, stejně jako dnešní `flipApplies(unknown)`. Chybějící parametr u `equals_none` znamená „viditelné“ (`undefined !== 'new'`). Propsáno do [[14-protokol#Schéma featur]].
