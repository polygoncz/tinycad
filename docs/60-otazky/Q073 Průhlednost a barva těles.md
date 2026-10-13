---
type: question
status: open
area: "[[09-vykreslovani]]"
decide_by: "[[M15-export-a-dokonceni]]"
proposal: "Barva a průhlednost jako další pole BodyMeta (color, opacity) s operacemi body.setColor/body.setOpacity; render je převezme do materiálu tělesa."
decision: ""
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

_(Až se rozhodne: vyplnit sem, nastavit `status: answered` a `decision`, rozhodnutí propsat do specifikace. Zásadní rozhodnutí → nové ADR.)_
