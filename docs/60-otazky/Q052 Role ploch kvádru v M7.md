---
type: question
status: answered
area: "[[06-geometricke-jadro]]"
decide_by: "[[M07-kernel-occt]]"
proposal: "Role až v M14, v M7 nevyplňovat"
decision: "role až v M14, v M7 nevyplňovat"
tags:
  - otazka
created: 2026-10-13
updated: 2026-10-13
---
# Q052 Role ploch kvádru v M7

**Oblast:** [[06-geometricke-jadro]] · **Rozhodnout do:** [[M07-kernel-occt]]

## Otázka

Úkol v [[M07-kernel-occt]] zní „`makeBox` (+ `roles` pro plochy)“, ale [[06-geometricke-jadro#Výsledek operace a historie|spec 06]] říká, že `ShapeResult.roles` se do M14 nevyplňuje. Kontraktová sada role netestuje a `FakeKernel` je nevrací. Máme role vyplňovat už v M7?

Spike ověřil, že `BRepPrimAPI_MakeBox` role umí (`TopFace`, `BottomFace`, `FrontFace`, `BackFace`, `LeftFace`, `RightFace`), viz [[0013-replicad-opencascadejs|ADR 0013]].

## Možnosti a návrh

- **A: Role až v [[M14-topologicke-pojmenovani|M14]], v M7 nevyplňovat.** Odpovídá spec a pravidlu „rozhraní roste s milníky“. Odstraní nesoulad úkolu a spec. Nevýhoda: až v M14 se k `makeBox` vrátíme.
- **B: Vyplnit v M7 v OCCT i ve `FakeKernel` a doplnit kontrakt.** Hned máme data pro M14. Nevýhoda: názvy rolí (`'face:top'`…) a jejich význam (co je „front“ – OCCT má `FrontFace` na +X, ne na −Y, jak by čekal uživatel s pohledem zepředu) navrhujeme dřív, než víme, co naming potřebuje.
- **C: Vyplnit jen v OCCT.** Nejméně práce, ale implementace se rozejdou bez kontraktu.

Návrh: **A**. Úkol v M7 upravit na „`makeBox` bez rolí (role v M14)“.

## Rozhodnutí

2026-10-13: **Varianta A.** `makeBox` v M7 role nevrací, stejně jako `FakeKernel`. Role (a jejich názvy) se navrhnou v [[M14-topologicke-pojmenovani|M14]]. Úkol v [[M07-kernel-occt]] upraven, [[06-geometricke-jadro|spec 06]] už to říká.
