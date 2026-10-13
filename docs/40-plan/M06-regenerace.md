---
type: milestone
status: todo
order: 6
aliases:
  - M6
  - M6 Regenerace a první plugin (Box)
modules:
  - regen
  - plugin-api
  - features
specs:
  - "[[07-regenerace]]"
  - "[[11-ui]]"
depends_on:
  - "[[M03-operace]]"
  - "[[M05-kernel-port]]"
started: 
finished: 
tags:
  - milnik
created: 2026-10-12
updated: 2026-10-12
---
# M6 – Regenerace a první plugin (Box)

**Cíl:** přehrání featur přes jádro s cache, rollback barem, chybovými stavy a správou handle. První plugin featury – kvádr. Celé testované s `FakeKernel`.

**Specifikace:** [[07-regenerace|07 – regenerace]], [[11-ui#Plugin featury (plugin-api)|11 – plugin-api]], [[0006-nemenna-data|ADR 0006]]

**Navazuje na:** [[M03-operace]], [[M05-kernel-port]]

## Úkoly

- [ ] `Body`, `RegenState`, `EMPTY_STATE`, `FeatureStatus`, `FeatureError`.
- [ ] `FeatureBuilder`, `BuildInput`, `BuildContext` (zatím jen `kernel`, `resolveBodies`, `warn`), `BuilderRegistry`.
- [ ] `Regenerator.run`: validace přes schéma, cache podle identity, rollback, suppressed, chybná featura propouští stav, neznámý typ.
- [ ] Generace a `'superseded'`.
- [ ] Mark & sweep uvolňování handle.
- [ ] Události `started`, `featureDone`, `finished`.
- [ ] `plugin-api`: `FeaturePlugin` **bez** `tools` (pole `tools` se přidá v M9, až bude existovat `interaction` – do té doby `plugin-api` závisí jen na `document` a `regen`).
- [ ] `features/box`: `BoxParams` (`origin`, `width`, `depth`, `height`), schéma (min > 0), builder, testy.
- [ ] Test „každý registrovaný typ má schéma i builder“ (pomocná funkce `registerPlugin` do testovacích registrů).

## Akceptační kritéria

- Testy ze sekce Testy ve spec 07 projdou (počty volání builderu, rollback, chyby, souběh, úniky).
- Property-based: regenerace s cache = regenerace od nuly; po sekvenci změn žádné úniky handle.
- `regen` neimportuje `ops`.

## Co se naučíš

Asynchronní řízení souběhu (generace), cache nad neměnnými daty, ruční správa zdrojů mimo GC.

## Retrospektiva

_(vyplnit po dokončení)_
