---
type: question
status: answered
area: "[[11-ui]]"
decide_by: "[[M10-ui]]"
proposal: "V M10 jen stav pohledu v interaction (neukládá se, nejde do undo); do dokumentu až bude potřeba."
decision: "Stav pohledu v interaction, neukládá se a nejde do undo; do dokumentu případně s M14."
tags:
  - otazka
created: 2026-10-13
updated: 2026-10-13
---
# Q071 Viditelnost těles

**Oblast:** [[11-ui]], [[10-interakce]], [[03-dokument]] · **Rozhodnout do:** [[M10-ui]]

## Otázka

Prohlížeč v novém rozvržení UI ([[11-ui]]) má u každého [[Těleso|tělesa]] přepínač viditelnosti (oko), jako Fusion. Je viditelnost součástí [[Dokument|dokumentu]] (uloží se, jde přes [[Operace|operaci]] a undo), nebo jen stav pohledu?

Komplikace: tělesa vznikají [[Regenerace|regenerací]] a do M14 nemají stabilní identitu ([[Topologické pojmenování]]). Viditelnost uložená k tělesu by se po změně historie mohla přenést na jiné těleso.

## Možnosti a návrh

1. **Stav pohledu.** Malý model v `interaction` (množina skrytých těles), `render` je jen neukáže. Neukládá se a nejde do undo.
   - \+ Žádná nová operace ani verze dokumentu. Problém s identitou těles nevadí, protože po reloadu je vše vidět.
   - − Po reloadu se skrytí ztratí.
2. **Data dokumentu.** Operace `body.setVisible` a uložení v `PartStudio`.
   - \+ Chování jako ve Fusion, přežije reload.
   - − Potřebuje stabilní identitu těles. Do M14 by viditelnost patřila spíš k featuře, která těleso vytvořila.
3. **Viditelnost featury** (skrýt všechna tělesa featury) jako data dokumentu.
   - \+ Featura má stabilní id.
   - − Neodpovídá přesně Prohlížeči, který ukazuje tělesa.

Návrh: **1** v M10. Možnost 2 přehodnotit s [[M14-topologicke-pojmenovani]].

## Rozhodnutí

2026-10-13 (Pavel): **možnost 1 – stav pohledu.** Skrytá tělesa drží model v `interaction`, `render` je nevykreslí. Neukládá se, nejde do undo, po reloadu je vše vidět. Přehodnotit s [[M14-topologicke-pojmenovani]]. Propsáno do [[10-interakce]] a [[11-ui]].
