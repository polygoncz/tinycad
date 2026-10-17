---
type: insight
status: seed
aliases:
  - Golden testy
  - Charakterizační testy pro přepis
topics:
  - testování
  - přepis
sources:
  - https://michaelfeathers.silvrback.com/characterization-testing
  - https://approvaltests.com/
  - "[[M38-zmrazeni-domeny]]"
tags:
  - poznatek
created: 2026-10-17
updated: 2026-10-17
---
# Golden testy pro přepis do jiného jazyka

**Shrnutí:** Při přepisu systému do jiného jazyka se dnešní testy nedají převést (tvrzení jsou kód), ale jejich vstupy ano: výstupy se zaznamenají ze staré implementace, uloží jako data a obě implementace je pak musí projít. Hlavní riziko přitom není chyba staré implementace, ale všechno, co druhý jazyk nezopakuje bit po bitu.

## Podrobnosti

- **Rekordér, ne parser testů.** Vstup se vytáhne z dnešního testu, výstup zapíše stará implementace (*characterization test* podle Featherse, *approval test*). Stejný spouštěč v jednom režimu zapisuje a ve druhém porovnává, takže případ nemůže zastarat a změna chování je vidět v diffu.
- **Zaznamenat neznamená ověřit.** Každý zapsaný výstup je potřeba porovnat s tvrzeními původního testu, jinak se do specifikace zmrazí i chyba. Rozpor se hlásí jako otázka, výstup se ručně nepřepisuje.
- **Co druhý jazyk nezopakuje:**
  - pořadí, které doména neurčuje (začátek smyčky z jádra, pořadí kontrol validace) – normalizovat před zápisem;
  - stabilita řazení – `Array.prototype.sort` je stabilní, `std::sort` ne, takže klíč řazení musí být úplný;
  - řazení řetězců podle jazyka (`localeCompare`) místo kódových jednotek;
  - čísla: `NaN` a ±∞ JSON tiše zapíše jako `null`; šum pod tolerancí může prohodit pořadí, proto se pro řazení zaokrouhluje;
  - texty chybových hlášek – porovnávat jen kód a cestu.
- **Tolerance podle veličiny:** délky absolutně, objemy relativně; kde stará implementace veličinu neumí přesně (objem ze sítě), volnější tolerance je vědomé rozhodnutí v datech případu.
- **Nejednoznačné výsledky** (nedourčená soustava, víc platných řešení) neporovnávat hodnotou, ale vlastností: výsledek je pevný bod řešiče, struktura sedí, tažený bod je na místě.
- Vedlejší efekt: případy odhalí díry ve specifikaci (nedosažitelné kódy chyb, chybějící výstup), protože každý druh musí mít přesně definovaný vstup a výstup.

## Jak to využívá tinycad

[[M38-zmrazeni-domeny|M38]]: 508 [[Sdílený testovací případ|sdílených případů]] zmrazené TS domény pro C++ jádro ([[0030-nativni-jadro-pres-grpc|ADR 0030]]), kontrakt v [[13-testovani#Sdílené testovací případy]], rozhodnutí [[Q107 Výstupy sdílených případů|Q107]]–[[Q110 Tolerance sdílených případů|Q110]]. Souvisí s [[Kontraktové testy portu]] (tvrzení jako kód, jeden jazyk) a [[Implicitní kontrakty první implementace]].

## Zdroje

- Michael Feathers: Characterization Testing – https://michaelfeathers.silvrback.com/characterization-testing
- ApprovalTests – https://approvaltests.com/
- [[M38-zmrazeni-domeny]] (průběh a revize architektury)
