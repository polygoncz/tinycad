---
type: question
status: answered
area: "[[10-interakce]]"
decide_by: "[[M09-interakce]]"
proposal: "Na rollback bar, bar za ni"
decision: "feature.add na index rollbackIndex; bar se posune sám (spec 03)"
tags:
  - otazka
created: 2026-10-13
updated: 2026-10-13
---
# Q068 Kam se vloží nová featura

**Oblast:** [[10-interakce]] · **Rozhodnout do:** [[M09-interakce]]

## Otázka

Kam `FeatureEditor.create()` vloží novou [[Featura|featuru]] a co se stane s [[Rollback bar|rollback barem]]?

## Možnosti a návrh

1. **Na pozici baru, bar za ni** – jako Onshape.
   - + uživatel vidí výsledek tam, kde pracuje.
2. **Vždy na konec**, bar na konec.
   - + jednodušší. − ztratí rozpracovaný stav za barem.

Návrh: **1**.

## Rozhodnutí

2026-10-13 (Pavel): **možnost 1.** Stačí `feature.add` s `index = rollbackIndex`: mutátor dokumentu posune bar při vložení na index `<= rollbackIndex` sám ([[03-dokument]]) a `applyOperation` ho při abortu vrátí. Posun je trvalý, takže je v logu. Propsáno do [[10-interakce]].
