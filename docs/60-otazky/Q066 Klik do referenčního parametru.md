---
type: question
status: answered
area: "[[10-interakce]]"
decide_by: "[[M09-interakce]]"
proposal: "Klik přesměruje SelectTool"
decision: "Zvláštní vnitřní nástroj refPick, který ToolManager zapne podle FeatureEditor.events"
tags:
  - otazka
created: 2026-10-13
updated: 2026-10-13
---
# Q066 Klik do referenčního parametru

**Oblast:** [[10-interakce]] · **Rozhodnout do:** [[M09-interakce]]

## Otázka

Když má dialog featury aktivní referenční [[Parametr featury|parametr]] (`bodies`, `topo`), klik ve viewportu má plnit tento parametr místo běžného [[Výběr|výběru]]. Kdo klik přesměruje? [[Nástroj]] kvádru po `features.create` hned skončí, takže aktivní je `SelectTool`.

## Možnosti a návrh

1. **`SelectTool`** se podívá na `ctx.features.current?.activeRefParam`.
   - + jedno místo, jednoduché testy. − `SelectTool` zná dialog.
2. **Zvláštní nástroj `refPick`.**
   - + čisté oddělení. − kdo ho zapne? Kdyby `FeatureEditor` volal `ToolManager`, vznikne cyklus (`ToolContext.features` je `FeatureEditor`).
3. **Odložit** přesměrování na první featuru s referenčním parametrem.

Návrh: 1.

## Rozhodnutí

2026-10-13 (Pavel): **možnost 2.** Cyklus se obejde obráceným směrem: `ToolManager` poslouchá `FeatureEditor.events`; dokud má aktuální session `activeRefParam !== null`, předává události vnitřnímu nástroji `refPick` (pick → `session.setParam`), potom se vrátí k předchozímu nástroji. `FeatureEditor` o nástrojích neví. Propsáno do [[10-interakce]].
