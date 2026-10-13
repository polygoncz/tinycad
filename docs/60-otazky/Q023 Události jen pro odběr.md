---
type: question
status: open
area: "[[02-core]]"
decide_by: "[[M02-dokument]]"
proposal: "Rozhraní Subscribable<E> s on/once v core, events ho vystavují místo Emitter"
decision: ""
tags:
  - otazka
created: 2026-10-13
updated: 2026-10-13
---
# Q023 Události jen pro odběr

**Oblast:** [[02-core]] · **Rozhodnout do:** [[M02-dokument]]

## Otázka

Specifikace [[03-dokument|03]], [[04-operace-a-historie|04]], [[05-persistence|05]], [[07-regenerace|07]], [[09-vykreslovani|09]] a [[10-interakce|10]] vystavují ve veřejných rozhraních `readonly events: Emitter<…>` (13 míst). Kdo dostane rozhraní jen kvůli odběru, dostane tím i `emit`. Komponenta, která dokument jen čte, by mohla sama vyvolat `doc.events.emit('changed', …)` a žádná kontrola to nechytí. To jde proti bodu 3 [[0011-programovani-proti-rozhranim|ADR 0011]] (úzká rozhraní podle role, oddělené čtení a zápis). Upozornil na to `architecture-reviewer` při revizi [[M01-core|M1]].

Máme ve veřejných rozhraních vystavovat jen odběr, a jak?

## Možnosti a návrh

1. **Rozhraní `Subscribable<E>` v `core`** s metodami `on` a `once`, které `Emitter` implementuje. Veřejná rozhraní mají `readonly events: Subscribable<…>`, implementace si drží `Emitter` soukromě.
   - \+ Stejný princip jako `Observable` vs. `ObservableValue`, který už máme. + Kompilátor `emit` zvenku nedovolí. + Změna v `core` je pár řádků.
   - − Úprava 13 míst v šesti specifikacích (mechanická).
   - Název: `EventSource` koliduje s globálem prohlížeče (Server-Sent Events), proto `Subscribable`.
2. **Metody přímo na rozhraní** (`doc.on('changed', fn)` místo `doc.events.on(…)`).
   - \+ Kratší zápis.
   - − Míchá odběr s doménovým API, každé rozhraní by muselo `on`/`once` deklarovat znovu.
3. **Nechat `Emitter`** a spoléhat na review.
   - \+ Žádná práce.
   - − Pravidlo, které nehlídá kompilátor, se dřív nebo později poruší.

Návrh: **1**. Je to stejný vzor jako u `Observable` a hlídá ho kompilátor.

## Rozhodnutí

_(Až se rozhodne: vyplnit sem, nastavit `status: answered` a `decision`, rozhodnutí propsat do specifikace. Zásadní rozhodnutí → nové ADR.)_
