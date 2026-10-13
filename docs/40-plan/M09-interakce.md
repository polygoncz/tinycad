---
type: milestone
status: todo
order: 9
aliases:
  - M9
  - M9 Interakce
modules:
  - interaction
  - plugin-api
specs:
  - "[[10-interakce]]"
depends_on:
  - "[[M08-vykreslovani]]"
started: 
finished: 
tags:
  - milnik
created: 2026-10-12
updated: 2026-10-13
---
# M9 – Interakce

**Cíl:** výběr, nástroje, obecný dialog featury nad transakcí a akce s klávesovými zkratkami. Všechno bez Vue, testované s `FakeKernel`.

**Specifikace:** [[10-interakce|10 – interakce]]

**Navazuje na:** [[M08-vykreslovani]]

## Úkoly

- [ ] `FakeViewport` pro testy (předpřipravený `pick`, ruční emit událostí).
- [ ] `SelectionModel`.
- [ ] `Tool`, `ToolContext`, `ToolDescriptor`, `ToolRegistry`, `ToolManager` (Esc, výchozí nástroj).
- [ ] `SelectTool` – hover, klik, Shift+klik, klik do prázdna = zrušit výběr.
- [ ] `FeatureEditor` a `FeatureEditSession` – `create`, `edit` (dočasný posun rollback baru), `setParam`, referenční parametry, `commit`, `cancel`.
- [ ] `Action`, `ActionRegistry` nad `ViewKeyEvent`, mapování zkratek (`Mod`), ignorování v textových polích.
- [ ] [[Prezentační model|Prezentační modely]] ([[0010-prezentacni-model|ADR 0010]]): `FeatureTreeModel` a `Observable` stav u `FeatureEditSession`, `ToolManager`, `ActionRegistry`, `SelectionModel`. Upřesnit tvary `TreeRow`, `FieldState`, `ActionState`.
- [ ] `plugin-api`: přidat `tools` do `FeaturePlugin`; `features/box/tool.ts` – nástroj, který otevře dialog.
- [ ] (Volitelné) Interaktivní tvorba kvádru tažením ve viewportu.

## Akceptační kritéria

- `FeatureEditSession`: create → 20× setParam → commit = 1 záznam v logu; cancel = beze změny.
- Úprava existující featury za rollback barem posune bar dočasně a po commit/cancel ho vrátí.
- `interaction` neimportuje `regen`, `kernel`, `render`, `ui` a nepoužívá DOM (projde `tsconfig.domain.json`).
- Celá logika stromu featur je testovaná v Node přes `FeatureTreeModel`, bez Vue.

## Co se naučíš

Stavové automaty nástrojů, oddělení „co uživatel dělá“ od „co se děje s dokumentem“.

## Retrospektiva

_(vyplnit po dokončení)_
