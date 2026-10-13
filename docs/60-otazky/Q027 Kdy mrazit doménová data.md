---
type: question
status: answered
area: "[[03-dokument]]"
decide_by: "[[M02-dokument]]"
proposal: "Mrazit vždy (Object.freeze bez přepínače), cena je při počtu featur zanedbatelná"
decision: "Mrazit vždy, bez přepínače"
tags:
  - otazka
created: 2026-10-13
updated: 2026-10-13
---
# Q027 Kdy mrazit doménová data

**Oblast:** [[03-dokument]] · **Rozhodnout do:** [[M02-dokument]]

## Otázka

[[0006-nemenna-data|ADR 0006]] a spec [[03-dokument|03]] říkají: [[Neměnná data|neměnná data]] se v dev režimu mrazí přes `Object.freeze`. Jak ale `document` pozná dev režim? Doménový prstenec nesmí znát platformu ani nástroje ([[0009-platformove-nezavisla-domena|ADR 0009]]): `tsconfig.domain.json` má `types: []`, takže `import.meta.env.DEV` (Vite) ani `process.env.NODE_ENV` (Node) v něm nejsou.

## Možnosti a návrh

1. **Mrazit vždy.** Žádný přepínač.
   - \+ Nejjednodušší, stejné chování v testech, dev i produkci. + Chyby ze zápisu do zmrazeného objektu se v produkci projeví stejně jako ve vývoji.
   - − Malá cena za běhu (rekurzivní freeze nových objektů). U desítek až stovek featur zanedbatelná. Mrazí se jen nově vytvořené objekty, ne celý strom.
2. **Přepínač předaný z `app`** (`createDocument({ freeze: true })` nebo globální `setDevMode` v `core`).
   - \+ Produkce bez ceny.
   - − Další konfigurace, kterou je potřeba protáhnout i do `fromData` a testů. Globální stav v `core`.
3. **Deklarovat `import.meta.env` v `core`** (vlastní `.d.ts`).
   - − Domain tím znovu závisí na Vite, obchází ADR 0009.

Návrh: **1**. Až by měření ukázalo problém, přidá se možnost 2. Rozhodnutí je potřeba propsat do ADR 0006 a spec 03 (vypustit „v dev režimu“).

## Rozhodnutí

Pavel schválil **možnost 1** (2026-10-13). `document` mrazí nově vytvořená doménová data vždy, bez přepínače. Propsáno do [[03-dokument|03]]; [[0006-nemenna-data|ADR 0006]] má pod rozhodnutím doplněné upřesnění.
