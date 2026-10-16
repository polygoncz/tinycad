---
type: question
status: answered
area: "[[12-skicar]]"
decide_by: "[[M36-zrcadleni-a-pole]]"
proposal: "Entita jako recept (zdroje + parametry), kopie odvozené po vyřešení originálu, mimo řešič; vazby na kopie ne; odvozená id <entita>:<index>.<zdroj>; vynesené kóty editují parametry entity."
decision: "Recept s odvozenými kopiemi podle návrhu; lineární pole se dvěma směry (Pavel 2026-10-16)."
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

- a) **Recept, kopie odvozené:** entita nese zdrojové entity a parametry (zrcadlení: osa; lineární pole: směr, počet a rozteč; kruhové pole: střed, počet a úhel). Kopie se dopočítají z **vyřešeného** originálu, do řešiče nevstupují. Vazby a kóty na kopie nejdou; snapper se ke kopii přichytí jen polohou, bez automatické vazby. Odvozená id `<id entity>:<index>.<id zdroje>`. Vynesené kóty jsou parametry entity, které popisek ve viewportu edituje (jako tah kóty z [[M28-koty|M28]]), ne vazby v seznamu.
- b) **Kopie jako entity řešiče** s vazbami pole; vazby na kopie jdou, ale změna počtu kopie přidává a maže, planegcs nemá vazbu rotace (kruhové pole by potřebovalo vlastní rovnice).

**Návrh:** a).

## Rozhodnutí

Pavel 2026-10-16: **a) recept s odvozenými kopiemi.** Lineární pole má **dva směry** (mřížka jako Onshape): směr 1 povinný, směr 2 volitelný, každý s počtem a roztečí. Zrcadlení je také recept (zdroje + osa), ne kopie s vazbou `symmetric`; vazba `symmetric` přesto vznikne jako samostatná geometrická vazba dvou bodů podle osy. Kontrakt dopíše stopa C do [[12-skicar]] v sekci M36 při úkolu 1 ([[M36-zrcadleni-a-pole#Implementační plán]]).
