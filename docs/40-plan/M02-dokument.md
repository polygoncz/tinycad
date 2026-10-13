---
type: milestone
status: done
order: 2
aliases:
  - M2
  - M2 Doménový model
modules:
  - document
specs:
  - "[[03-dokument]]"
depends_on:
  - "[[M01-core]]"
started: 2026-10-13
finished: 2026-10-13
tags:
  - milnik
created: 2026-10-12
updated: 2026-10-13
---
# M2 – Doménový model

**Cíl:** dokument jako neměnný recept featur, schémata featur s validací a migrací, serializace do JSON.

**Specifikace:** [[03-dokument|03 – dokument]], [[0003-dokument-je-recept|ADR 0003]], [[0004-data-oddelene-od-chovani|ADR 0004]], [[0006-nemenna-data|ADR 0006]]

**Navazuje na:** [[M01-core]]

## Úkoly

- [x] Typy: `DocumentId`, `FeatureId`, `BodyId`, `TopoName`, `FeatureInstance`, `PartStudioData`, `DocumentMeta`, reference (`BodyRef`, `TopoRef`, `SketchRegionRef`).
- [x] `DocumentReader`, `DocumentWriter`, `DocumentEvents`.
- [x] `createDocument` (interně třída `CadDocument`) – mutátory s invarianty, strukturální sdílení, `Object.freeze` vždy ([[Q027 Kdy mrazit doménová data|Q027]]).
- [x] `ParamSpec`, `ParamSchema`, `FeatureSchema`, `ParamIssue`.
- [x] `validateAgainstSchema` pro všechny `ParamSpec.kind`.
- [x] `FeatureSchemaRegistry`.
- [x] `toData` / `fromData` včetně migrace podle `typeVersion` a zachování neznámých typů.
- [x] Testovací buildery: `aFeature()`, `aDocument()` (v `document/testing.ts`, exportované zvlášť, aby se nedostaly do produkčního bundlu).

## Akceptační kritéria

- Po `replaceFeature` jsou ostatní instance `===` původním (test).
- `fromData(toData(doc))` je ekvivalentní a `JSON.parse(JSON.stringify(data))` je hluboce rovno `data`.
- Featura uložená ve verzi 1 se načte přes schéma verze 2 s migrací.
- Neznámý typ featury dokument nerozbije.
- `document` importuje jen `core`.

## Co se naučíš

Návrh neměnného doménového modelu v TS (`readonly`, `Readonly<T>`), diskriminované uniony (`ParamSpec`), verzování datového formátu.

## Retrospektiva

> _Návrh od Clauda – Pavel doplní nebo upraví._

**Co bylo jinak, než se čekalo**
- Spec 03 vypadala hotově, ale při implementaci vzniklo pět nových otázek ([[Q025 Featura z novější verze|Q025]]–[[Q029 Posun rollback baru při změnách featur|Q029]]). Nejzajímavější je Q029: žádné pravidlo posunu [[Rollback bar|rollback baru]] podle indexu není samo o sobě invertovatelné, protože index rovný `rollbackIndex` je dvojznačný. Přesné undo proto zajistí obecně dispečer v `ops`, ne dokument.
- Data zvenku potřebují jiný režim než data uvnitř. `fromData` bere `unknown` a vrací `Result` s cestami k chybám ([[Q026 Chyby při načítání dokumentu|Q026]]), `validate` bere `unknown` místo `P`, a i `deepFreeze` musel na hranici dokumentu přestat důvěřovat „už zmrazeným“ objektům.
- Detaily TypeScriptu: `Readonly<unknown>` je `{}`, ne `unknown` – dvakrát to vynutilo kontrolu, která chyběla (výsledek `migrate` musí být objekt). Pravidlo „`migrate` povinná od verze 2“ nejde vyjádřit typem, hlídá ho registr.
- Samostatný testovací vstupní bod `testing.ts` potřeboval nová pravidla dependency-cruiseru; revize v nich našla díru (typová závislost pouštěla k hodnotám).
- `architecture-reviewer` našel skutečnou chybu (mělce zmrazený objekt zvenku zůstal měnitelný uvnitř) a nesoulad specifikace s chováním při výjimce odběratele ([[Q030 Výjimka odběratele po změně dokumentu|Q030]]).

**Co se osvědčilo**
- Rozhodnutí z otázek hned propsat do specifikací – spec 03 teď popisuje skutečné chování, včetně krajních případů.
- Tabulkové testy (`it.each`) pro pravidla rollback baru: celé chování je vidět na jednom místě a pokrývá pozice před barem, na baru i za ním.
- Ověřit pravidla lintu na dočasných souborech, které je mají porušit – „žádné chyby“ samo nic nedokazuje.
- Typové testy (`expectTypeOf`, `@ts-expect-error`) pro vlastnosti, které za běhu neexistují: značky id, `readonly`, chybějící `emit`, povinné `params` v builderu.
- Revize architektury před commitem: opravy jsou součástí jednoho commitu milníku.
