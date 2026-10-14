---
type: question
status: answered
area: "[[09-vykreslovani]]"
decide_by: "[[M15-export-a-dokonceni]]"
proposal: "Barva a průhlednost jako další pole BodyMeta (color, opacity) s operacemi body.setColor/body.setOpacity; render je převezme do materiálu tělesa."
decision: "barva v BodyMeta.color a operace body.setColor v M15; průhlednost se nedělá (Další nápady)"
tags:
  - otazka
created: 2026-10-14
updated: 2026-10-14
---
# Q073 Průhlednost a barva těles

**Oblast:** [[09-vykreslovani]], [[03-dokument]] · **Rozhodnout do:** [[M15-export-a-dokonceni]]

## Otázka

Skrývání [[Těleso|těles]] je od [[M11-dalsi-entity|M11]] v metadatech těles v dokumentu ([[Q071 Viditelnost těles|Q071]], [[Q017 Průhlednost a skrývání těles|Q017]]). Zbývá průhlednost a barva tělesa: patří také do metadat dokumentu, nebo jsou to vlastnosti pohledu? A jak je `render` vykreslí (průhledné materiály, pořadí kreslení)?

Vyčleněno z Q017 v noční rychloakci ([[Rozhodnutí noční rychloakce#M11 – Další entity]]): v M11 pro ně není spotřebitel a průhlednost v Three.js má vlastní úskalí (řazení průhledných objektů, hloubkový buffer), které nesouvisí s tématem M11.

## Možnosti a návrh

1. **Metadata dokumentu:** `BodyMeta.color?: string` (`#rrggbb`) a `opacity?: number` (0–1), operace `body.setColor`, `body.setOpacity`; `render` dostane barvu a krytí tělesa přes port vedle `setBodyVisible`.
   - \+ Jako Fusion (vzhled tělesa se ukládá), mechanismus z M11 se jen rozšíří.
   - − Průhlednost v Three.js vyžaduje řazení a `depthWrite: false`.
2. **Barva v dokumentu, průhlednost jen dočasně v pohledu** (např. „zprůhlednit ostatní“ při editaci featury).
   - \+ Průhlednost jako pomůcka při práci, ne vlastnost modelu.
   - − Dva mechanismy.

Návrh: **1** pro barvu, průhlednost rozhodnout podle potřeby v M15 (export do STEP barvy nenese, takže barva je čistě vzhled).

## Rozhodnutí

2026-10-14 (noční rychloakce, [[Rozhodnutí noční rychloakce#M15 – Export a dokončení|R129]] ⚠): **Varianta 1 pro barvu, průhlednost se nedělá.** `BodyMeta.color` (`'#rrggbb'` malými písmeny, `isBodyColor`), operace `body.setColor` (v logu i undo jako skrývání, R13), `BrowserModel.colors` a `setColor`, `Viewport.setBodyColor` s materiálem podle barvy, výběr barvy v Prohlížeči. Proč: mechanismus metadat z M11 se jen rozšíří o jedno pole a barva prochází všemi vrstvami (dokument → operace → prezentační model → render) – dobrý závěrečný příklad. Průhlednost potřebuje řazení průhledných objektů a `depthWrite: false` a zatím nemá spotřebitele → [[M15-export-a-dokonceni#Další nápady (mimo rozsah)|Další nápady]]. STEP barvy nenese (R123). Propsáno do [[03-dokument#Metadata těles]], [[04-operace-a-historie#Sada operací]], [[09-vykreslovani#Viewport]], [[10-interakce#Prohlížeč: `BrowserModel` a viditelnost těles]], [[11-ui#Komponenty]].
