---
type: question
status: answered
area: "[[03-dokument]]"
decide_by: "[[M02-dokument]]"
proposal: "Chybějící parametr je ParamIssue, přebytečný se ignoruje"
decision: "Chybějící i přebytečný parametr je ParamIssue"
tags:
  - otazka
created: 2026-10-13
updated: 2026-10-13
---
# Q028 Chybějící a přebytečné parametry

**Oblast:** [[03-dokument]] · **Rozhodnout do:** [[M02-dokument]]

## Otázka

`validateAgainstSchema(schema, params)` kontroluje [[Parametr featury|parametry]] podle `ParamSpec` (typ, min/max, počet referencí). Spec [[03-dokument|03]] neříká, co s klíči, které nesedí na [[Schéma featury|schéma]]:

- **chybějící** parametr – schéma ho má, `params` ne,
- **přebytečný** parametr – `params` ho mají, schéma ne.

Druhý případ nastane typicky u neúplné migrace nebo ručně upravených dat.

## Možnosti a návrh

1. **Chybějící = `ParamIssue`, přebytečný ignorovat.**
   - \+ Featura bez povinného parametru jde vidět jako chyba. + Přebytečná data neškodí a validace nemusí znát historii formátu – úklid je práce `migrate`.
   - − Překlep v názvu parametru (`widht`) se projeví jen jako „chybí `width`“.
2. **Obojí jako `ParamIssue`.**
   - \+ Nejpřísnější, odhalí neúplnou migraci.
   - − Featura zčervená kvůli datům, která nic nedělají.
3. **Chybějící doplnit z `defaults()`** a nehlásit.
   - \+ Pohodlné.
   - − Validace by data měnila – to je práce migrace, ne validace. Tichá změna.

Návrh: **1**. Validace hlásí jen to, co brání výpočtu. `ParamSpec` typu reference s `min: 0` (nepovinná reference) se chová jako prázdné pole, ne jako chybějící.

## Rozhodnutí

Pavel zvolil **možnost 2** (2026-10-13): `validateAgainstSchema` hlásí jako `ParamIssue` chybějící i přebytečný parametr.

- Důsledek: `migrate` musí po sobě uklidit i parametry, které nová verze schématu nemá. Neúplná migrace se tak projeví hned.
- Referenční parametr (`bodies`, `topo`, `region`) se zadává vždy, i když je prázdný (`[]`). Chybějící klíč je chyba i při `min: 0`.
- Propsáno do [[03-dokument|03]].
