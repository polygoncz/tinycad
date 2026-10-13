---
type: adr
status: accepted
number: 7
aliases:
  - ADR 0007
  - Vlastní topologické pojmenování místo OCAF/TNaming
date: 2026-10-12
related:
  - "[[08-topologicke-pojmenovani]]"
supersedes: 
tags:
  - adr
created: 2026-10-12
updated: 2026-10-12
---
# 0007 – Vlastní topologické pojmenování místo OCAF/TNaming

- **Stav:** Přijato (`status: accepted`)
- **Datum:** 2026-10-12
- **Souvisí:** [[08-topologicke-pojmenovani]]

## Kontext

Featury se odkazují na plochy a hrany předchozích featur. Po regeneraci vzniknou nové tvary s jinými indexy (topological naming problem). OCCT nabízí obecný framework OCAF s balíkem TNaming, který to řeší přes atributy v datovém stromu.

## Rozhodnutí

Topologické pojmenování si napíšeme sami ([[08-topologicke-pojmenovani|spec 08]]):
- plochy pojmenovává featura, která je vytvořila (sémanticky: `box1/face:top`, `extrude1/face:side:<entita skici>`),
- hrany a vrcholy se jmenují podle sousedních ploch,
- jména se přenášejí přes operace podle historie OCCT (`Generated`, `Modified`, `IsDeleted`), kterou adaptér jádra vrací spolu s výsledkem,
- přenos je čistá funkce v TypeScriptu testovatelná bez jádra.

## Zvažované alternativy

- **OCAF/TNaming** – hotové a ověřené, ale těžkopádné, svazuje doménu s datovým modelem OCCT a skrývá právě ten mechanismus, který se chceme naučit.
- **Reference podle geometrie** (najdi plochu s normálou +Z nejvýš) – jednoduché, ale nespolehlivé a tiše přeskakuje na jiné entity.

## Důsledky

- + Plné pochopení a kontrola nad mechanismem; doména nezávisí na OCAF.
- + Jména jsou čitelná v ladění i v uloženém dokumentu.
- − Okrajové případy (rozdělené plochy, více hran mezi dvěma plochami) musíme vyřešit sami.
- − Adaptér jádra musí poctivě vracet historii u každé operace.
