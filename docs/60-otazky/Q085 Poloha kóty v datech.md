---
type: question
status: answered
area: "[[12-skicar]]"
decide_by: "[[M28-koty]]"
proposal: "Volitelná vlastnost placement u kóty relativně ke kótovaným entitám (odsazení od kótovací přímky a posun podél ní; u poloměru úhel a vzdálenost od středu). Chybějící = výchozí poloha, takže bez migrace a bez nové verze schématu."
decision: "Volitelná vlastnost placement relativně ke kótovaným entitám, chybějící = výchozí poloha; bez migrace a bez nové verze schématu."
tags:
  - otazka
created: 2026-10-15
updated: 2026-10-15
---
# Q085 Poloha kóty v datech

**Oblast:** [[12-skicar#Data (`sketch`)]], [[03-dokument]] · **Rozhodnout do:** [[M28-koty]]

## Otázka

Přetažená kóta ([[M28-koty|M28]]) si musí pamatovat polohu popisku. Jak ji uložit, aby (1) přežila uložení dokumentu, (2) se pohnula s geometrií, když se změní rozměry, a (3) staré dokumenty bez polohy zůstaly platné?

## Možnosti a návrh

- a) **Absolutní 2D bod v rovině skici.**
  - \+ Nejjednodušší.
  - − Po změně kóty z 10 na 100 mm zůstane popisek na starém místě, daleko od geometrie.
- b) **Relativně ke kótovaným entitám:** u lineární kóty odsazení od kótovací přímky (se znaménkem) a posun podél ní, u poloměru/průměru úhel a vzdálenost od středu, u úhlové poloměr oblouku kóty.
  - \+ Kóta se pohybuje s geometrií jako ve Fusionu.
  - − Pro každý druh kóty vlastní tvar; převod polohy myši ↔ data je čistá funkce na druh.
- **Formát:** vlastnost `placement` je **volitelná** (chybí = dnešní výchozí poloha z M19.2), takže staré dokumenty jsou platné beze změny, `parseSketchData` ji jen ověří a nová verze schématu skici není potřeba. Alternativou je povinné pole a migrace na verzi 2.

**Návrh:** b) s volitelnou vlastností. Druh kóty (vodorovná/svislá/zarovnaná) je součást vazby (mění řešení), poloha ne – proto je oddělená a nevstupuje do řešiče.

## Rozhodnutí

Pavel 2026-10-15: **relativně, volitelně** (návrh b s volitelnou vlastností). Propsáno do [[12-skicar#Kóty (M28)]].
