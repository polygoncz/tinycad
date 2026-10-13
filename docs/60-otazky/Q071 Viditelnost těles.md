---
type: question
status: answered
area: "[[11-ui]]"
decide_by: "[[M10-ui]]"
proposal: "V M10 jen stav pohledu v interaction (neukládá se, nejde do undo); do dokumentu až bude potřeba."
decision: "Od M11 možnost 2: metadata těles v dokumentu (BodyMeta.hidden/name, operace body.setVisible a body.rename, v logu i undo). M10: stav pohledu."
tags:
  - otazka
created: 2026-10-13
updated: 2026-10-14
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

### Přehodnocení 2026-10-14 (M11)

Claude, noční rychloakce ([[Rozhodnutí noční rychloakce#M11 – Další entity|R13]]; k revizi Pavlem). Úkol z [[Revize architektury 2026-10-13]] (nález 2) chtěl přehodnocení už v [[M11-dalsi-entity|M11]], ne až v M14.

**Možnost 2 – data dokumentu**, rozšířená o jméno tělesa. Důvod, proč už teď: námitka „potřebuje stabilní identitu těles“ padla s [[0015-artefakty-a-identita-telesa|ADR 0015]] v [[M10.1-zpevneni-kostry|M10.1]]. `BodyId` je rodokmen (`<featura původu>/body[:n]`), ne pořadí výstupu jádra, takže se skrytí po změně historie nepřenese na jiné těleso. Topologické pojmenování (M14) se týká ploch a hran, ne celých těles.

- Model: `PartStudioData.bodies?: Record<BodyId, { name?, hidden? }>` v kanonickém tvaru ([[03-dokument#Metadata těles]]).
- Operace `body.rename` a `body.setVisible` s inverzí, v logu i v undo jako každá jiná změna dokumentu ([[04-operace-a-historie#Sada operací]]). ⚠ Fusion skrývání do historie undo nedává; tady jde přes jeden mechanismus (log), protože co se ukládá, musí jít přes operaci. Kdyby to vadilo, dá se vyjmout z undo bez změny formátu.
- Prohlížeč čte jméno a viditelnost z dokumentu ([[10-interakce#Prohlížeč: `BrowserModel` a viditelnost těles]]). Během otevřeného dialogu a v režimu jen pro čtení viditelnost měnit nejde (transakce, resp. odmítající dispečer) – oproti M10 zúžení ([[Rozhodnutí noční rychloakce#M11 – Další entity|R14]]).
- Barva a průhlednost: [[Q073 Průhlednost a barva těles|Q073]].
