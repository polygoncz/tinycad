---
type: adr
status: accepted
number: 5
aliases:
  - ADR 0005
  - Operační log (event sourcing), undo jako inverzní operace
date: 2026-10-12
related:
  - "[[04-operace-a-historie]]"
  - "[[05-persistence]]"
supersedes: 
tags:
  - adr
created: 2026-10-12
updated: 2026-10-12
---
# 0005 – Operační log (event sourcing), undo jako inverzní operace

- **Stav:** Přijato (`status: accepted`)
- **Datum:** 2026-10-12
- **Souvisí:** [[04-operace-a-historie]], [[05-persistence]]

## Kontext

Potřebujeme undo/redo, průběžné ukládání a rádi bychom měli kompletní historii úprav (jako mikroverze v Onshape). Klasický vzor Command s `execute/undo` drží undo jen v paměti.

## Rozhodnutí

- Každá změna dokumentu je serializovatelná **operace** aplikovaná přes `OperationDispatcher`.
- Operace se zapisují do **append-only logu** spolu se svou inverzí (spočítanou před aplikací).
- Undo nemaže historii: připíše inverzní operaci jako nový záznam (`kind: 'undo'`). Redo připíše původní operaci znovu.
- Undo/redo zásobníky jsou odvozené z logu (`UndoManager.rebuild`) → undo funguje i po znovuotevření dokumentu.
- Ukládání = připisování záznamů logu do IndexedDB + občasný snapshot.
- Interakce, které mají být jedním krokem (dialog featury, tažení, skicování), používají **transakce**.
- Operace musí být deterministické – ID a čas se generují před vytvořením operace.

## Zvažované alternativy

- **Snapshot celého dokumentu po každé změně** – jednodušší, ale nedává historii úprav a s velkým dokumentem je drahý.
- **Klasický Command pattern v paměti** – bez trvalé historie a bez základu pro synchronizaci.
- **Undo mazáním posledního záznamu z logu** – jednodušší log, ale ztrácí se historie a komplikuje se budoucí synchronizace.

## Důsledky

- + Trvalé undo, levné inkrementální ukládání, auditovatelná historie.
- + Základ pro budoucí větvení verzí nebo synchronizaci s backendem.
- − Log žije navždy → změna tvaru operace vyžaduje `upcast`. Proto málo malých typů operací.
- − Determinismus je povinnost, kterou musí hlídat testy (replay test).
