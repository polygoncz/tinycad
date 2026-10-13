---
type: question
status: answered
area: "[[05-persistence]]"
decide_by: "[[M04-persistence]]"
proposal: "Result s chybou not-found / snapshot / entry"
decision: "Result<LoadedDocument, LoadDocumentError> se třemi druhy chyby"
tags:
  - otazka
created: 2026-10-13
updated: 2026-10-13
---
# Q033 Tvar chyby při načtení dokumentu

**Oblast:** [[05-persistence]] · **Rozhodnout do:** [[M04-persistence]]

## Otázka

Jak má `loadDocument` hlásit, že dokument nejde načíst? [[Q026 Chyby při načítání dokumentu|Q026]] rozhodla, že poškozená data jsou očekávaný stav (`Result`), ne výjimka. Načtení ale může selhat na více místech: dokument ve storu není, [[Snapshot|snapshot]] je poškozený, nebo je poškozený záznam [[Operační log|logu]].

## Možnosti a návrh

1. **`Result` se sjednocením druhů chyby** (`kind: 'not-found' | 'snapshot' | 'entry'`).
   - \+ UI může každý druh ukázat jinak (dokument neexistuje vs. je poškozený od záznamu 137).
   - \+ Stejný vzor jako `fromData`.
2. **Výjimka** s kódem.
   - − Odporuje Q026, volající snadno zapomene na `catch`.
3. **Jeden obecný `{ path, message }`.**
   - − Ztratí se, jestli je vadný snapshot, nebo záznam.

Návrh: **1**.

## Rozhodnutí

2026-10-13: **Varianta 1.** `loadDocument` vrací `Result<LoadedDocument, LoadDocumentError>`, kde chyba je `not-found`, `snapshot` (s `DocumentLoadError` nebo chybou obálky snapshotu) nebo `entry` (s `seq` a `OperationLoadError`). Chyby I/O storu (IndexedDB selže) nejsou chyba dat a letí jako odmítnutý `Promise`. Propsáno do [[05-persistence#Načtení dokumentu]].
