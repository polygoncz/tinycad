---
type: question
status: answered
area: "[[13-testovani]]"
decide_by: "[[M38-zmrazeni-domeny]]"
proposal: "Vstupy psát ručně nebo vytáhnout z dnešních testů, očekávané výstupy zaznamenat z TS domény skriptem npm run cases:record a revidovat v git diffu."
decision: "Vstupy ručně nebo z dnešních testů, výstupy zaznamenané z TS skriptem cases:record; TS sada je při každém npm run check přehraje a porovná s uloženými, změna chování je vidět v git diffu."
tags:
  - otazka
created: 2026-10-17
updated: 2026-10-17
---
# Q107 Výstupy sdílených případů

**Oblast:** [[13-testovani]], [[0030-nativni-jadro-pres-grpc|ADR 0030]] · **Rozhodnout do:** [[M38-zmrazeni-domeny|M38]]

## Otázka

[[Sdílený testovací případ|Sdílené testovací případy]] mají být specifikací C++ jádra. Dnešní testy jsou ale tvrzení v kódu (`expect(...)`), kontraktová sada jádra v `src/kernel/testing.ts` má ~3600 řádků. Odkud se vezme očekávaný výstup případu v JSON?

## Možnosti a návrh

**A. Zaznamenat z TS (návrh).** Vstup se napíše ručně nebo se vytáhne z dnešního testu, skript `npm run cases:record` ho přehraje přes TS doménu a zapíše výstup. TS sada pak v `npm run check` přehraje tytéž vstupy a porovná je s uloženými výstupy (s tolerancí).
- \+ Výstupy nikdo nepřepisuje ručně, takže v nich nejsou překlepy. Případ nemůže tiše zastarat.
- \+ Změna chování TS se ukáže v git diffu případů, kde se dá posoudit.
- − Zaznamená se i případná chyba TS. Zmírnění: při revizi případu se výstup porovná s tvrzeními původního testu (`source`).

**B. Psát výstupy ručně podle dnešních tvrzení.**
- \+ Každá hodnota je vědomě zkontrolovaná.
- − Stovky případů ručně, u geometrie (oblouky, offsety) prakticky nemožné.

**C. Automaticky převést dnešní testy** (parser `it(...)` a `expect`).
- − Tvrzení jsou libovolný kód (smyčky, pomocné funkce), obecný převod nejde.

## Rozhodnutí

**Varianta A (Pavel 2026-10-17, podle návrhu Clauda).** „Exportér“ z [[M38-zmrazeni-domeny|M38]] je rekordér, ne parser testů. Režimy: `npm run cases:record` (zapíše výstupy), běžný test (porovná). Propsáno do [[13-testovani#Sdílené testovací případy]].
