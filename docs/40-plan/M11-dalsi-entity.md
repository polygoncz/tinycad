---
type: milestone
status: todo
order: 11
aliases:
  - M11
  - M11 Další entity
modules:
  - features
  - kernel-occt
specs:
  - "[[06-geometricke-jadro]]"
  - "[[07-regenerace]]"
  - "[[10-interakce]]"
depends_on:
  - "[[M10-ui]]"
started: 
finished: 
tags:
  - milnik
created: 2026-10-12
updated: 2026-10-12
---
# M11 – Další entity: Cylinder, Transform, Boolean

**Cíl:** ověřit rozšiřitelnost. Přidat tři nové featury **bez změny kódu mimo `src/features/*`** (a nových operací jádra). Kde to nejde, opravit architekturu a zapsat proč.

**Specifikace:** [[06-geometricke-jadro|06]], [[07-regenerace|07]], [[10-interakce|10]]

> Hrubý plán – před zahájením upřesnit.

**Navazuje na:** [[M10-ui]]

## Úkoly

- [ ] **Cylinder** – `PrimitiveOps.makeCylinder` (Fake + OCCT), plugin. Měřítko: kolik souborů mimo `features/cylinder` se změnilo? Cíl: jen registrace + jádro.
- [ ] **Transform** – `TransformOps.transform`, plugin s parametrem `bodies` a posunem/rotací; těleso si ponechá `BodyId`.
- [ ] **Boolean** – `BooleanOps.boolean`, plugin (`op`, `targets`, `tools`, `keepTools`); výsledek dědí `BodyId` prvního cíle, nástroje zmizí.
- [ ] `RefListField` v UI pro parametry typu `bodies` + výběr těles ve viewportu během dialogu.
- [ ] `BuildContext.resolveBodies` – chyba `UNRESOLVED_REFERENCE`, když těleso neexistuje.
- [ ] Scénář: kvádr, válec, boolean rozdíl; smazání válce → boolean červený, kvádr v pořádku.

## Akceptační kritéria

- Tři nové featury fungují v aplikaci včetně undo a ukládání.
- Seznam souborů změněných mimo `features/` je zapsaný v retrospektivě a zdůvodněný.

## Retrospektiva

_(vyplnit po dokončení)_
