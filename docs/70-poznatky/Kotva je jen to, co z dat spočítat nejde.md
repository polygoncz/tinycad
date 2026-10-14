---
type: insight
status: seed
aliases:
  - Minimální kotva
  - Expensive stable vs. cheap live
topics:
  - interaktivní UI
  - asynchronní programování
sources:
  - https://cad.onshape.com/FsDoc/
  - "[[M18-manipulatory]]"
tags:
  - poznatek
created: 2026-10-14
updated: 2026-10-14
---
# Kotva je jen to, co z dat spočítat nejde

**Shrnutí:** interaktivní prvek nad asynchronním výpočtem rozděl na drahou a stabilní část z výpočtu a levnou a živou část z aktuálních dat. Do drahé části dávej jen to, co z dat opravdu spočítat nejde.

## Podrobnosti

Gizmo, úchyt nebo náhled, jehož poloha závisí na výsledku pomalého výpočtu (geometrické jádro, server, worker), se za kurzorem zpožďuje o dobu výpočtu. Pomůže rozdělení na dvě části:

- **Kotva** z výpočtu: geometrie, kterou zná jen výpočet (vyřešené reference, obálky, roviny). Je stabilní, takže stačí, že přijde pozdě.
- **Živá část** z aktuálních dat: kotva + parametry, počítaná synchronně při každém pohybu myši.

Nutná podmínka je, že kotva nesmí záviset na parametru, který úchyt táhne. Jinak by se úchyt honil sám za sebou. Lepší pravidlo je ale přísnější: kotva má být **minimální**. Všechno, co jde spočítat z dat (přepínač směru, typ konce, ručně zadaný bod), patří do živé části. Každý parametr navíc v kotvě znamená, že úchyt po změně v dialogu čeká na výpočet, i když čekat nemusí.

Onshape (FeatureScript) vytváří manipulátory přímo ve featuře během regenerace a pohyb převádí na parametry oddělenou funkcí. Je to stejné rozdělení, jen hrubší: celý úchyt vzniká ve výpočtu.

## Jak to využívá tinycad

[[0021-manipulatory-kotvy-z-regenerace|ADR 0021]], [[Kotva manipulátoru]], [[07-regenerace#Kotvy manipulátorů (M18)]]. Revize [[M18-manipulatory|M18]] přesunula `flip` Extrude a `pivotPoint` Transformace z kotvy do `handles()`.

## Zdroje

- Onshape FeatureScript – Manipulators (`addManipulators`, manipulator change function).
- [[M18-manipulatory]] – retrospektiva a úkol 9.
