---
type: insight
status: seed
aliases:
  - Onshape
topics:
  - parametrické modelování
  - Onshape
sources: []
tags:
  - poznatek
created: 2026-10-12
updated: 2026-10-12
---
# Jak Onshape modeluje s historií

**Shrnutí:** Onshape ukládá recept (seznam featur), ne geometrii; reference na geometrii jsou dotazy vyhodnocované při každé regeneraci a každá změna je trvalá mikroverze.

## Podrobnosti

- **Jádro na serveru:** Onshape používá Parasolid na svých serverech, prohlížeč jen zobrazuje a ovládá.
- **Part Studio:** seřazený seznam featur s rollback barem; přepočet lineárně od změněné featury.
- **Chybná featura** zčervená, ale model se nerozbije – navazující featury se počítají dál.
- **Reference jako dotazy (queries)** ve FeatureScriptu, např. „plochy vytvořené featurou extrude1, koncové víko“. Řeší topological naming problem; je to jejich hlavní know-how.
- **Mikroverze:** každá změna dokumentu se ukládá jako trvalý krok historie; nad tím jsou verze a větve.
- **Dialog featury:** nástroj otevře dialog s výchozími parametry, živý náhled, OK/Zrušit.

## Jak to využívá tinycad

- Recept místo geometrie: [[0003-dokument-je-recept]]
- Mikroverze → [[Operační log]] a [[0005-operacni-log]]
- Dotazy → [[Topologické pojmenování]] a [[0007-vlastni-topologicke-pojmenovani]]
- Dialog featury → `FeatureEditSession` v [[10-interakce]]

## Zdroje

- Konverzace s Claudem 2026-10-12 (obecná znalost; detaily ověřit v dokumentaci Onshape a FeatureScriptu, až budou potřeba).
