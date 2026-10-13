---
type: question
status: answered
area: "[[03-dokument]]"
decide_by: "[[M02-dokument]]"
proposal: "Mutátory: vložení na index <= rollbackIndex bar posune, smazání před barem ho stáhne; inverze v ops si pamatují původní rollbackIndex"
decision: "Možnost 1: jednoduchá pravidla v mutátorech, dispečer obecně doplní do inverze obnovu rollbackIndex"
tags:
  - otazka
created: 2026-10-13
updated: 2026-10-13
---
# Q029 Posun rollback baru při změnách featur

**Oblast:** [[03-dokument]] · **Rozhodnout do:** [[M02-dokument]]

## Otázka

Spec [[03-dokument|03]] říká jen: „vložení featury posune [[Rollback bar|rollback bar]], pokud se vkládá před něj“. Pro `insertFeature`, `removeFeature` a `moveFeature` potřebujeme přesná pravidla – a taková, aby [[Undo a redo|undo]] přes inverzní operace ze [[04-operace-a-historie|spec 04]] obnovilo dokument **přesně**.

Problém: index rovný `rollbackIndex` je dvojznačný – featura vložená na tuto pozici může ležet těsně před barem, nebo těsně za ním. Protipříklad pro pravidlo „vložení na `index <= rollbackIndex` posune bar“:

1. `[A, B, C]`, `rollbackIndex = 2` – `C` je za barem (neaktivní).
2. `feature.remove C` (index 2) – bar se nemění.
3. Undo = `feature.add C` na index 2 – pravidlo bar posune na 3, `C` je najednou aktivní.

Pravidlo „jen `index < rollbackIndex`“ má stejný problém opačně: smazání poslední aktivní featury a undo ji vrátí za bar. Žádné pravidlo jen podle indexu není inverzní pro oba případy.

## Možnosti a návrh

1. **Mutátory s jednoduchým pravidlem, inverze si pamatují bar.**
   - `insertFeature(i)`: `i <= rollbackIndex` → bar +1 (nová featura na baru je aktivní, jak to dělá Onshape).
   - `removeFeature(i)`: `i < rollbackIndex` → bar −1.
   - `moveFeature`: jako smazání a vložení – přesunutá featura převezme stav cílové pozice, ostatní si stav nechají.
   - Inverze `feature.remove` a `feature.move` v `ops` ([[M03-operace|M3]]) jsou transakce, které po vrácení featury nastaví i původní `rollbackIndex` (`studio.setRollback`).
   - \+ Dokument má jednoduchá, srozumitelná pravidla. + Přesnost undo zaručí `ops` – tam už je mechanismus [[Transakce|transakcí]].
   - − Inverze jsou o krok složitější.
2. **`insertFeature` dostane explicitní volbu** (`insertFeature(i, f, { active: boolean })`), inverze předá původní stav.
   - \+ Mutátor sám o sobě je přesně invertovatelný.
   - − Volba prosakuje do operace `feature.add` a do UI; volající musí vždy myslet na bar.
3. **Rollback bar jako id poslední aktivní featury** (`rollbackAfter: FeatureId | null`) místo indexu.
   - \+ Vložení a smazání jiných featur bar vůbec neovlivní.
   - − Velká změna spec 03, 04, 07 i pojmu; smazání featury, na které bar „visí“, potřebuje vlastní pravidlo; regenerace stejně potřebuje index.

Návrh: **1**. Pravidla v dokumentu zůstanou jednoduchá a přesnost undo se řeší tam, kde se inverze tvoří. Test v M3: pro každou operaci `apply` + `inverse` vrátí dokument, který je hluboce roven původnímu, včetně `rollbackIndex`.

## Rozhodnutí

Pavel nechal volbu na doporučení s ohledem na budoucí flexibilitu, velké změny nevadí (2026-10-13). Zvolena **možnost 1**, doplněná o obecný mechanismus v dispečeru:

- **Pravidla v dokumentu** (`r` = `rollbackIndex`, platí pro aktivní/neaktivní stav *ostatních* featur, který se nemění):
  - `insertFeature(i)`: `i <= r` → `r + 1`. Featura vložená na bar je aktivní (jako v Onshape).
  - `removeFeature(i)`: `i < r` → `r − 1`.
  - `moveFeature(from → to)`: jako smazání na `from` a vložení na `to`. Přesunutá featura převezme stav cílové pozice.
- **Přesnost undo zajistí `ops`, obecně, ne každý handler zvlášť:** když se po `apply` změní `rollbackIndex`, dispečer inverzi obalí do `batch[inverze, studio.setRollback(původní)]`. Každá budoucí operace je tak vůči baru správná automaticky.
- **Proč ne možnost 3:** dvojznačnost „nová featura vs. bar na stejném místě“ zůstává i u baru jako id, undo by bar stejně muselo obnovovat explicitně. Regenerace i API Onshape pracují s indexem.
- Propsáno do [[03-dokument|03]] a [[04-operace-a-historie|04]]. Ověří replay test v [[M03-operace|M3]].
