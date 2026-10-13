---
type: insight
status: seed
aliases:
  - Invertovatelnost operací se značkou v seznamu
  - Undo a kurzor v seznamu
topics:
  - undo/redo
  - command pattern
sources:
  - https://en.wikipedia.org/wiki/Command_pattern
  - https://en.wikipedia.org/wiki/Operational_transformation
tags:
  - poznatek
created: 2026-10-13
updated: 2026-10-13
---
# Undo u pozičních operací

**Shrnutí:** když seznam nese značku (kurzor, rollback bar, výběr) a vkládání/mazání ji implicitně posouvá, inverzní operace podle indexu nevrátí stav přesně – inverze musí obnovit i stav značky zachycený před provedením.

## Podrobnosti

- Pozice rovná pozici značky je **dvojznačná**: vložený prvek může ležet těsně před ní, nebo těsně za ní. Pravidlo „`i <= značka` → posunout“ rozbije undo smazání prvku za značkou, pravidlo „`i < značka`“ rozbije undo smazání posledního prvku před ní. Žádné pravidlo jen podle indexu není inverzní pro oba případy.
- Změna reprezentace (značka jako id prvku místo indexu) dvojznačnost neodstraní – jen ji přesune.
- Robustní řešení: inverzi počítat **ze stavu před provedením** a obnovit v ní i stav značky. Nejlépe obecně v jednom místě (dispečer operací), ne v každém handleru – pak je správná i každá budoucí operace.
- Ověření: vlastnostní test (fast-check) „náhodná sekvence operací + undo vrátí hluboce stejný stav“.
- Příbuzný problém řeší [[Operační log|operační logy]] při souběžné editaci (operational transformation): poziční operace jsou křehké, kotvy podle id robustnější.

## Jak to využívá tinycad

- [[Q029 Posun rollback baru při změnách featur|Q029]]: mutátory dokumentu posouvají [[Rollback bar|rollback bar]] jednoduchými pravidly, přesné [[Undo a redo|undo]] zajistí dispečer v `ops`, který při změně `rollbackIndex` obalí inverzi do `batch[inverze, studio.setRollback(původní)]` ([[04-operace-a-historie|spec 04]]).

## Zdroje

- Gamma, Helm, Johnson, Vlissides: *Design Patterns* – Command (undo přes inverzní příkaz).
- Wikipedia: Command pattern; Operational transformation.
