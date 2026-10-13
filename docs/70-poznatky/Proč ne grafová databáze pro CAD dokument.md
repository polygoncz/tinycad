---
type: insight
status: seed
aliases:
  - Grafová DB a CAD
  - Úložiště parametrického modelu
topics:
  - persistence
  - databáze
  - event sourcing
sources:
  - https://martinfowler.com/eaaDev/EventSourcing.html
  - https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system
  - https://sqlite.org/wasm/doc/trunk/persistence.md
tags:
  - poznatek
created: 2026-10-13
updated: 2026-10-13
---
# Proč ne grafová databáze pro CAD dokument

**Shrnutí:** Vztahy v CAD modelu (constraints, závislosti featur, reference na plochy) jsou graf, ale úložiště ho nemusí umět dotazovat, když se dokument vždycky načítá celý a ukládá se jako recept.

## Podrobnosti

- **Co se ukládá, určuje typ úložiště.** Při event sourcingu se ukládá append-only log operací a občasné snapshoty. Potřebné dotazy jsou jen tři: připsat záznamy, přečíst záznamy jednoho dokumentu podle pořadí a přečíst poslední snapshot. Na to stačí klíč–hodnota se složeným klíčem (`[docId, seq]`), tedy přesně to, co umí IndexedDB.
- **Graf žije v paměti.** Vazby jsou ID uvnitř dat. Graf závislostí se z nich odvodí při načtení a regenerace stejně potřebuje celý. Referenční integritu hlídají invarianty dokumentu při načtení (`fromData`), ne cizí klíče v databázi.
- **Kdy by se grafová (nebo relační) DB vyplatila:**
  - dotazy na **část** obřího grafu bez načtení celku (sestavy se statisíci díly),
  - dotazy **napříč dokumenty** („kde všude je použitý díl X“),
  - víc současných klientů nad sdílenými daty (to už je backend a kolaborace).
- **V prohlížeči** grafová DB nativně není. Šlo by jen o WASM (SQLite, Kùzu) nad OPFS, za cenu několika MB a druhého WASM runtime.
- **OPFS** se hodí na velká binární data (cache BREP a sítí), klidně vedle IndexedDB.
- **Volbu nezamyká port.** Úložiště za portem s kontraktovými testy jde později vyměnit (např. SQLite nad OPFS) bez dopadu na zbytek aplikace (viz [[Kontraktové testy portu]]).

## Jak to využívá tinycad

Rozhodnutí [[Q008 OPFS nebo IndexedDB]] a [[0005-operacni-log|ADR 0005]]: IndexedDB pro log a snapshoty v [[05-persistence]]. Vztahy mezi featurami řeší [[Q013 Graf závislostí featur]] v paměti, cache geometrie [[Q007 Cache geometrie]].

## Zdroje

- Martin Fowler: Event Sourcing.
- MDN: Origin private file system.
- SQLite WASM: persistence options (OPFS).
