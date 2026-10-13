---
type: milestone
status: doing
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
finished: 
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

_(vyplnit po dokončení)_
