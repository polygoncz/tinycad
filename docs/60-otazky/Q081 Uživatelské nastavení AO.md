---
type: question
status: answered
area: "[[11-ui]]"
decide_by: "[[M23-postprocessing-a-ao]]"
proposal: "Samostatná předvolba AoSettings (ne v DisplayStyle), 5 posuvníků a tlačítko Výchozí v plovoucím panelu otevřeném z menu stylu položkou Nastavení AO…"
decision: "a + iii + A: samostatná předvolba AoSettings; poloměr a síla nahoře, tloušťka, distanceFallOff, scale a samples v části Pokročilé; plovoucí panel z položky Nastavení AO… v menu stylu."
tags:
  - otazka
created: 2026-10-15
updated: 2026-10-15
---
# Q081 Uživatelské nastavení AO

**Oblast:** [[11-ui]], [[09-vykreslovani#Víceprůchodové vykreslování (AO)]] · **Rozhodnout do:** [[M23-postprocessing-a-ao]]

## Otázka

Pavel 2026-10-15: parametry AO (poloměr, tloušťka, `distanceFallOff`, `scale`, `samples`) nemají být jen dočasný ladicí panel pro vývoj, ale nastavení dostupné uživateli. [[Styl zobrazení]] je dnes plochá hodnota přepínačů. Zbývá rozhodnout:

1. **Kde hodnoty žijí:** uvnitř `DisplayStyle`, nebo jako samostatná předvolba?
2. **Které parametry uživatel uvidí:** všech pět, nebo jen srozumitelné (poloměr, síla) a zbytek jako konstanty?
3. **Kde je ovládání:** posuvníky přímo v menu stylu, nebo samostatný panel?

## Možnosti a návrh

**1. Kde hodnoty žijí:**
- a) **Samostatná předvolba `AoSettings`** (typ v `render`, reexport z `app`). Ukládá se pod `tinycad.aoSettings` a čtení se validuje po polích jako u stylu. Do viewportu jde přes `ViewSettings.setAoSettings` → `Viewport.setAoSettings`.
  - \+ `DisplayStyle` a `resolveDisplay` zůstanou ploché přepínače a plán se nemusí znovu počítat při každém posunu posuvníku.
  - \+ Výchozí hodnoty se dají později změnit, aniž by se rozbil uložený styl.
  - − Druhý controller a druhý klíč v úložišti.
- b) **Pole v `DisplayStyle`** (`aoRadiusPx`…).
  - \+ Jeden controller, jedno úložiště.
  - − Styl se rozroste o čísla, která patří jen k jednomu přepínači. `samePlan` by plán měnil při každém tahu posuvníkem.

**2. Parametry:**
- i) **Všech pět** (poloměr v px, tloušťka v px, `distanceFallOff`, `scale`, `samples`) a tlačítko **Výchozí**.
  - \+ Přesně to, co Pavel chtěl ladit.
  - − Tloušťka, `distanceFallOff` a `samples` jsou pro uživatele CAD těžko srozumitelné.
- ii) **Poloměr a síla** (`intensity`), ostatní pevně jako konstanty.
  - \+ Jednoduché.
  - − Nejde s tím doladit výchozí hodnoty.
- iii) **Poloměr a síla nahoře, ostatní v rozbalovací části Pokročilé.**

**3. Ovládání:**
- A) Položka menu **Nastavení AO…** pod přepínačem AO otevře malý plovoucí panel u menu se skleněným vzhledem plovoucích panelů a s posuvníky (`input type="range"` s popiskem a hodnotou). Zavírá se křížkem, Esc nebo klikem mimo. Položka je zašedlá tam, kde je zašedlý přepínač AO.
  - \+ Menu zůstane menu (`menu-navigation` neumí posuvníky).
  - \+ Panel zůstane otevřený, zatímco uživatel ladí a otáčí kamerou.
- B) Posuvníky přímo v menu.
  - − Posuvník není `menuitem`. Šipky menu by se tloukly s šipkami posuvníku a menu se zavírá klikem mimo, tedy i klikem do scény.

**Návrh:** a + iii + A. Hodnoty se mění živě. Ukládá se po puštění posuvníku (`change`), ne při každém `input`. Výchozí hodnoty doladíme v [[M23-postprocessing-a-ao|M23]] (úkol 6) a zapíšeme do konstant v `ao-parameters.ts` a do spec 09. Nejde o změnu hranic modulů, takže ADR není potřeba. Stačí doplnit [[0026-viceprochodove-vykreslovani-ve-viewportu|ADR 0026]] o vazbu na tuto otázku.

## Rozhodnutí

Pavel 2026-10-15 schválil návrh **a + iii + A**:

- **Data:** samostatná předvolba `AoSettings`. Typ, výchozí hodnoty a rozsahy jsou v `render`, `app` je reexportuje. Uloží se pod `tinycad.aoSettings`.
- **Parametry:** poloměr a síla nahoře. Tloušťka, `distanceFallOff`, `scale` a `samples` jsou v rozbalovací části *Pokročilé*. Panel má i tlačítko *Výchozí*.
- **Ovládání:** položka **Nastavení AO…** v menu stylu otevře plovoucí panel.

**Upřesnění při zápisu do spec:** panel se zavírá jen křížkem a klávesou Esc, **ne** klikem mimo. Klik do scény je i začátek otáčení kamerou a panel má při ladění zůstat otevřený. Návrh v A si tu odporoval.

Propsáno do [[09-vykreslovani#Víceprůchodové vykreslování (AO)]] a [[11-ui#Komponenty]]. Dočasný ladicí panel v `app`, navržený dřív, odpadá.
