---
type: question
status: answered
area: "[[05-persistence]]"
decide_by: "[[M04-persistence]]"
proposal: "V M4 export jen stavu; export s logem odložit do M15"
decision: "V M4 jen stav; export s historií v M15"
tags:
  - otazka
created: 2026-10-13
updated: 2026-10-14
---
# Q036 Export dokumentu s historií

**Oblast:** [[05-persistence]] · **Rozhodnout do:** [[M04-persistence]]

## Otázka

Spec 05 původně říkala, že `.tinycad.json` obsahuje „poslední snapshot + volitelně celý log“. Má export v M4 nést i [[Operační log|log]] (a tedy undo historii mezi počítači)?

Háček: aby šel log po importu přehrát a ověřit, potřebuje soubor i **základní [[Snapshot|snapshot]]** (stav na `atSeq 0`), ze kterého log začíná. Ten nemusí být prázdný dokument (dokument mohl sám vzniknout importem). Export s logem tedy nejde udělat jako čistou funkci nad živým dokumentem a logem, potřebuje základní snapshot ze storu nebo z `loadDocument`.

## Možnosti a návrh

1. **M4: jen stav** (`snapshot` s `atSeq 0`). Export s historií odložit do [[M15-export-a-dokonceni|M15]].
   - \+ Jednoduchá čistá funkce, formát se dá později rozšířit (`formatVersion`, volitelné `base` + `entries`).
   - − Po importu není undo historie.
2. **M4: volitelně i log** – soubor `{ base, entries, snapshot }`, `exportDocument` dostane základní snapshot (např. vrácený z `loadDocument`).
   - \+ Splní původní záměr hned.
   - − `LoadedDocument` musí nést i základní snapshot, víc kódu a testů v M4 pro funkci, kterou UI využije až v M15.

Návrh: **1**. Formát je verzovaný, rozšíření o historii nic nerozbije.

## Rozhodnutí

2026-10-13: **Varianta 1.** V M4 nese `.tinycad.json` jen stav (snapshot s `atSeq 0`). Export s historií (`base` + `entries`) se doplní v [[M15-export-a-dokonceni|M15]] jako rozšíření formátu (`formatVersion`). Propsáno do [[05-persistence#Export a import souboru]].

> [!note] Doplnění M15 (2026-10-14, noční rychloakce, [[Rozhodnutí noční rychloakce#M15 – Export a dokončení|R125]] ⚠)
> Historie se doplňuje podle varianty 2, jen ze strany storu: `.tinycad.json` verze 2 nese volitelné `history: { base, entries }` a `snapshot.atSeq = entries.length`. Export dělá `exportStoredDocument(store, id, …)` z uloženého stavu (základní snapshot má jen store, `app` předtím zavolá `flush()`), takže `LoadedDocument` se nemění. Import historii ověří přehráním `base` + `entries` proti snapshotu (neshoda = chyba dat ze souboru) a uloží základní snapshot, záznamy i stav, undo se tak přenese. UI exportuje vždy s historií; soubor verze 1 se dál načte. Propsáno do [[05-persistence#Export a import souboru]].
