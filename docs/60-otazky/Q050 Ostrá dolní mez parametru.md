---
type: question
status: answered
area: "[[03-dokument]]"
decide_by: "[[M10-ui]]"
proposal: "přidat do ParamSpec pro length/angle/number volitelné exclusiveMin: boolean"
decision: "exclusiveMin/exclusiveMax u length, angle, number; validateAgainstSchema je respektuje, vlastní pravidlo v boxu zmizí."
tags:
  - otazka
created: 2026-10-13
updated: 2026-10-13
---
# Q050 Ostrá dolní mez parametru

**Oblast:** [[03-dokument]], [[11-ui]] · **Rozhodnout do:** [[M10-ui]]

## Otázka

`ParamSpec` ([[03-dokument]]) umí jen inkluzivní `min`. Rozměr kvádru má být ostře kladný, a to schéma vyjádřit neumí. `features/box` má proto `min: 0` a vlastní pravidlo ve `validate`, které odmítne nulu. Generovaný formulář ([[11-ui]]) ale ze schématu uvidí jen `min: 0` a nulu nabídne jako platnou, odmítne ji až validace. Má `ParamSpec` umět ostrou mez? Našel to implementátor v M6 (Ú7).

## Možnosti a návrh

1. **`exclusiveMin?: boolean`** (případně i `exclusiveMax`) u `length`, `angle`, `number`; `validateAgainstSchema` ho respektuje.
   - \+ Formulář i validace mají jednu pravdu, vlastní pravidlo v boxu zmizí. Stejná potřeba přijde u válce, extrude…
   - − Rozšíření schématu (verze dokumentu se nemění, jde o kód schémat).
2. **Malé kladné minimum** (např. `min: 1e-6`).
   - − Potichu zavádí délkovou toleranci a jednotky.
3. **Nechat vlastní pravidlo** ve `validate` každé featury.
   - − Formulář nezná pravdu, pravidlo se opakuje.

Návrh: **1**, implementovat v M10 spolu s generovaným formulářem.

## Rozhodnutí

2026-10-13 (Pavel): **možnost 1.** `exclusiveMin?: boolean` a `exclusiveMax?: boolean` u `length`, `angle`, `number`; `validateAgainstSchema` je respektuje a formulář je zná. Box přejde na `min: 0, exclusiveMin: true`. Propsáno do [[03-dokument]].
