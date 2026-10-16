---
type: question
status: open
area: "[[12-skicar]]"
decide_by: "[[M36-zrcadleni-a-pole]]"
proposal: ""
decision: ""
tags:
  - otazka
created: 2026-10-16
updated: 2026-10-16
---
# Q089 Parametrické zrcadlení a pole ve skice

**Oblast:** [[12-skicar#Data (`sketch`)]], [[12-skicar#Řešič vazeb]] · **Rozhodnout do:** [[M36-zrcadleni-a-pole]]

## Otázka

Pavel 2026-10-16: zrcadlení, lineární a kruhové pole jako **parametrická entita** (počet a rozteč jdou změnit i po vytvoření), „plus by tam bylo dobré mít i vynesené kóty podobně jako v Onshape nebo Fusion“ – tedy počet, rozteč a úhel jako upravitelné popisky ve viewportu.

Parametrická entita odvozuje kopie z originálu. Otevřené je:
1. **Identita kopií:** potřebují stabilní id (na id křivek stojí jména oblastí a ploch vysunutí, [[08-topologicke-pojmenovani]]). Odvozené id typu `<pole>:<i>:<id originálu>`? Co se stane s referencemi, když se počet sníží?
2. **Vazby na kopie:** smí uživatel navázat vazbu nebo kótu na kopii (např. tečnost kopie k jiné křivce)? Pokud ano, kopie musí být v řešiči jako proměnné a pole jako sada vazeb; pokud ne, kopie jsou jen odvozená kresba a do řešiče nevstupují.
3. **Řešič:** pole jako vazby v planegcs (symetrie k ose, rotace o úhel – planegcs nemá vazbu rotace) nebo kopie dopočítané po vyřešení originálu?
4. **Vynesené kóty:** jsou počet, rozteč a úhel parametry entity, které popisek ve viewportu jen edituje (jako kóty z [[M28-koty|M28]]), nebo skutečné kóty v seznamu vazeb?

## Možnosti a návrh

_(Doplnit při startu M36, po prototypu v planegcs.)_

## Rozhodnutí
