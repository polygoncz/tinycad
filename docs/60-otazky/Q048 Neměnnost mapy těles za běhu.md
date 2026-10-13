---
type: question
status: answered
area: "[[07-regenerace]]"
decide_by: "[[M06-regenerace]]"
proposal: "stačí ReadonlyMap v typu; RegenState se mrazí jen na úrovni objektu"
decision: "jen typ ReadonlyMap, objekt stavu se mrazí, mapa za běhu ne"
tags:
  - otazka
created: 2026-10-13
updated: 2026-10-13
---
# Q048 Neměnnost mapy těles za běhu

**Oblast:** [[07-regenerace]] · **Rozhodnout do:** [[M06-regenerace]]

## Otázka

[[0006-nemenna-data|ADR 0006]] říká, že doménová data se mrazí `Object.freeze` vždy. [[Stav regenerace]] drží tělesa v `ReadonlyMap`, ale `Object.freeze` mapu nezmrazí – `Map.set` za běhu projde, chrání jen typ při kompilaci. Má být mapa těles neměnná i za běhu? Našel to implementátor v Ú1.

## Možnosti a návrh

1. **Jen typ `ReadonlyMap`**, objekt stavu se mrazí.
   - \+ Žádný kód navíc. `RegenState` nevzniká z cizích dat (dokument, soubor), píšou ho jen buildery v repu a ty hlídá typecheck a lint (žádné `any`, žádné přetypování).
   - − Přetypování `as Map` by mutaci propustilo bez chyby.
2. **Vlastní neměnná mapa** (obal implementující `ReadonlyMap`, `set` neexistuje).
   - \+ Ochrana i za běhu.
   - − Obal kolem každého stavu, builder musí místo `new Map(state.bodies).set(…)` volat pomocníka.
3. **`bodies` jako zmražené pole nebo objekt** místo mapy.
   - − Ztráta rychlého hledání podle `BodyId`, změna spec.

Návrh: **1** – ADR 0006 míří na data, která přicházejí zvenku a sdílí se s UI; tady by obal stál víc, než chrání.

## Rozhodnutí

2026-10-13: **varianta 1**. Propsáno do [[07-regenerace#Princip|spec 07]].
