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
  - "[[M10.1-zpevneni-kostry]]"
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

**Navazuje na:** [[M10.1-zpevneni-kostry]]

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

## Úkoly z revize architektury (doplněno 2026-10-13, [[M10.1-zpevneni-kostry]])

Nálezy 2 a 3 z [[Revize architektury 2026-10-13]], jejichž první spotřebitel vzniká až tady. Zapracovat do Implementačního plánu při startu M11.

- [ ] **Pravidlo identity u Transform a Boolean** ([[07-regenerace]]): Transform zachová `id`, `origin`, `names`, nastaví `lastModifiedBy`; Boolean dědí `id` prvního cíle, nástroje z mapy odebere; `keepTools` je zachová beze změny; více výsledných solidů → `bodyId(cíl.origin, n)` podle rodokmenu z historie jádra (`Generated`/`Modified`), ne podle pořadí výstupu. Test: změna parametru válce nepřehodí id dvou výsledných těles.
- [ ] **Pravidla závislostí v `interaction`** ([[10-interakce]]): `FeatureTreeModel.move(id, toIndex)` (nový příkaz pro budoucí tažení v Timeline) odmítne přesun, po kterém `orderViolations` není prázdné; akce `feature.delete` nejdřív spočítá `dependentsOf` a UI zobrazí potvrzení „N featur ztratí referenci“ (jako Fusion); řádek Timeline nese `dependents: number` pro tooltip. Testy v Node s `dependenciesOf` z `document`.
- [ ] **Metadata těles v dokumentu** ([[03-dokument]], [[04-operace-a-historie]]): `PartStudioData.bodies?: Readonly<Record<BodyId, { name?: string; hidden?: boolean }>>` a operace `body.rename`, `body.setVisible` s inverzí; Prohlížeč jméno zobrazí a viditelnost ukládá sem místo stavu pohledu (přehodnotit [[Q071 Viditelnost těles|Q071]]: identita je od M10.1 rodokmen, takže už se nepřenese na jiné těleso). Barva až s [[Q017 Průhlednost a skrývání těles|Q017]].
- [ ] **Měřítko rozšiřitelnosti:** do retrospektivy zapsat seznam souborů mimo `features/*` změněných kvůli novým entitám, odděleně od souborů změněných kvůli úkolům výše.
