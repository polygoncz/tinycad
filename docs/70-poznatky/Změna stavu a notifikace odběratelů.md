---
type: insight
status: seed
aliases:
  - Mutate then notify
  - Výjimka odběratele po změně stavu
topics:
  - zpracování chyb
  - události
  - event sourcing
sources:
  - https://martinfowler.com/eaaDev/EventSourcing.html
  - https://nodejs.org/api/events.html#error-events
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/try...catch#the_finally_block
tags:
  - poznatek
created: 2026-10-13
updated: 2026-10-13
---
# Změna stavu a notifikace odběratelů

**Shrnutí:** každé místo, kde kód nejdřív změní stav a pak upozorní odběratele, musí předem rozhodnout, co udělá, když upozornění selže – stav buď **dotáhne do konzistence** a výjimku odloží, nebo se **vrátí zpět**. A odběratel nesmí během změny spustit další změnu.

## Podrobnosti

- Výjimka z odběratele vypadá jako selhání operace, ale stav už změněný je. Volající, který ji bere jako „nic se nestalo“, rozbije invarianty (např. log přestane odpovídat dokumentu).
- **Rozlišit selhání od výjimky po změně** jde levně u neměnných dat: porovnat identitu stavu před a po.
- **Dotáhnout, nebo vrátit?** Když změnu vrátit nejde (zapsaný záznam, změněný dokument), dotáhni zbytek (zapiš do logu, vyšli další události) a výjimky vyhoď až na konci. Když vrátit jde (zahájení transakce), udělej krok atomický.
- **Sbírat, nepřepisovat.** Výjimky z několika kroků patří do jednoho seznamu a vyhazují se nakonec (jedna jak je, víc jako `AggregateError`). Past: `finally`, který sám vyhodí, v JS tiše **nahradí** výjimku z `try`.
- **Reentrance.** Odběratel, který během aplikace změny spustí další změnu, ji dokončí dřív než vnější – v logu je pak pořadí jiné než ve skutečnosti. Buď ji zakázat (assert s příznakem „aplikuje se“), nebo frontovat. Zákaz je jednodušší a nechá volání synchronní.
- Každé nové místo „změň a notifikuj“ (log `appended`, `applied`, začátek a konec transakce) potřebuje stejnou úvahu – vyplatí se ji mít jako pravidlo, ne řešit ad hoc.

## Jak to využívá tinycad

Dispečer v [[04-operace-a-historie|ops]] dotahuje zápis do [[Operační log|operačního logu]] a výjimky odkládá ([[Q030 Výjimka odběratele po změně dokumentu|Q030]]), `begin` [[Transakce|transakce]] je atomický, reentrance je zakázaná a `commit`/`abort` sbírají výjimky do jednoho seznamu. Obecné pravidlo sběru chyb je v [[Sběr chyb místo logování]].

## Zdroje

- Martin Fowler: Event Sourcing; dokumentace Node.js k chybám v `EventEmitter`; MDN k bloku `finally` (viz `sources`).
