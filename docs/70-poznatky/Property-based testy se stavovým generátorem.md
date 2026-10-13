---
type: insight
status: seed
aliases:
  - Model-based testing
  - Generátor abstraktních kroků
topics:
  - testování
  - property-based testing
sources:
  - https://fast-check.dev/docs/advanced/model-based-testing/
  - https://hypothesis.works/articles/rule-based-stateful-testing/
  - https://www.cs.tufts.edu/~nr/cs257/archive/john-hughes/quick.pdf
tags:
  - poznatek
created: 2026-10-13
updated: 2026-10-13
---
# Property-based testy se stavovým generátorem

**Shrnutí:** u systému se stavem negeneruj rovnou operace, ale **abstraktní kroky** (druh + čísla), které se na platné operace přeloží až podle aktuálního stavu – každá sekvence je pak platná a shrinking dál funguje.

## Podrobnosti

- Operace nad stavem mají předpoklady (featura musí existovat, undo musí jít). Generovat je předem nejde, protože stav závisí na předchozích krocích.
- Řešení: krok nese jen „záměr“ – `{ k: 'remove', i: 7 }`. Interpret ho přeloží proti živému stavu: index = `i mod počet`, a když krok nejde provést, přeskočí ho. Generátor zůstává jednoduchá kombinace `oneof`/`record`/`array`.
- Shrinking pracuje nad abstraktními kroky, takže zmenšený protipříklad je pořád platná sekvence a dá se přečíst.
- Vlastnost se formuluje jako **rovnost dvou cest** ke stejnému výsledku: živá session vs. přehrání logu, živé zásobníky vs. přepočet z logu. Nepotřebuje znát správný výsledek.
- **Ověř, že test kouše:** dočasně vlož chybu (např. přehrání bez posledního záznamu) a zkontroluj, že ji test najde. Zelený test bez toho nic nedokazuje.
- Alternativa je plné model-based testování (`fc.commands` ve fast-checku, stavové testy v Hypothesis) s explicitním modelem; když existuje „druhá cesta“ jako replay, stačí jednodušší varianta.

## Jak to využívá tinycad

Replay test v [[M03-operace|M3]] generuje operace, dávky, [[Transakce|transakce]] a [[Undo a redo|undo/redo]] a ověřuje [[Determinismus operací|determinismus]]: přehrání [[Operační log|logu]] na prázdný dokument = živý dokument ([[04-operace-a-historie]], [[13-testovani]]). Stejný přístup se hodí pro regeneraci a skicář.

## Zdroje

- fast-check: model-based testing; Hypothesis: rule-based stateful testing; Claessen a Hughes: QuickCheck (viz `sources`).
