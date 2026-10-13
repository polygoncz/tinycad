---
type: question
status: answered
area: "[[10-interakce]]"
decide_by: "[[M09-interakce]]"
proposal: "Dočasný posun jako Onshape"
decision: "Dočasný posun mimo log: přechodná operace tx.applyTransient"
tags:
  - otazka
created: 2026-10-12
updated: 2026-10-12
---
# Q018 Rollback bar při editaci starší featury

**Oblast:** [[10-interakce]] · **Rozhodnout do:** [[M09-interakce]]

## Otázka

Co se stane s [[Rollback bar|rollback barem]], když uživatel edituje featuru, která je před ním nebo za ním?

## Možnosti a návrh

Onshape při editaci featury dočasně posune rollback bar za ni. Návrh: `edit()` uloží původní pozici a v [[Transakce|transakci]] ji dočasně posune; po commitu/cancelu vrátí.

## Rozhodnutí

2026-10-13 (Pavel): **dočasný posun jako Onshape, mimo log.**

Upřesnění při zápisu: páry `studio.setRollback` (posun tam a zpět) v transakci nesousedí (mezi nimi jsou `feature.setParams`), takže je `compress` přes `merge` nesloučí. Proto nový obecný mechanismus v [[04-operace-a-historie|ops]]: **přechodná operace** `Transaction.applyTransient(op)`. Aplikuje se hned (náhled vidí posunutý bar), při `commit` i `abort` se automaticky vrátí svou inverzí a do záznamu v logu se nedostane. Kontrakt: přechodná operace musí komutovat s logovanými operacemi transakce (přehrání logu bez ní dá stejný dokument); `studio.setRollback` vůči `feature.setParams` tuto podmínku splňuje.

`FeatureEditor.edit(id)` přechodně nastaví bar těsně za editovanou featuru (`index + 1`), ať je před barem, nebo za ním. Pozdější featury se během editace nepřehrávají a náhled ukazuje model ve stavu editované featury (jako Onshape). Je-li bar už na `index + 1`, nic se neaplikuje. Propsáno do [[10-interakce]] a [[04-operace-a-historie]].
