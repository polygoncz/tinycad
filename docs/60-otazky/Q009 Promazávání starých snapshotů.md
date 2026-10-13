---
type: question
status: answered
area: "[[05-persistence]]"
decide_by: "[[M04-persistence]]"
proposal: "Nechat poslední 3"
decision: "Základní snapshot + poslední 3, mazání v saveSnapshot ve stejné transakci"
tags:
  - otazka
created: 2026-10-12
updated: 2026-10-13
---
# Q009 Promazávání starých snapshotů

**Oblast:** [[05-persistence]] · **Rozhodnout do:** [[M04-persistence]]

## Otázka

Kolik [[Snapshot|snapshotů]] držet a kdy je mazat?

## Možnosti a návrh

Nechat poslední 3. Log se nemaže nikdy.

## Rozhodnutí

2026-10-13: **Store drží poslední 3 snapshoty** (podle `atSeq`) **a navíc vždy základní snapshot** (`atSeq 0`). Ze základního se přehrává celý log při kontrole konzistence. Importovaný dokument nezačíná prázdný, takže „stav na začátku logu“ se odvodit nedá. Starší maže `saveSnapshot` ve stejné transakci jako zápis nového, takže pravidlo zná jen store, ne služba. Log se nemaže nikdy. Propsáno do [[05-persistence#Port]].
