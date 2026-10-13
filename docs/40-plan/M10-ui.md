---
type: milestone
status: todo
order: 10
aliases:
  - M10
  - M10 UI a první aplikace
modules:
  - app
  - ui
specs:
  - "[[11-ui]]"
depends_on:
  - "[[M04-persistence]]"
  - "[[M09-interakce]]"
started: 
finished: 
tags:
  - milnik
created: 2026-10-12
updated: 2026-10-13
---
# M10 – UI a první použitelná aplikace

**Cíl:** všechno se propojí. Spustitelná aplikace, ve které jde vytvořit kvádr, upravit ho v dialogu, vidět ve 3D, vrátit změny a po reloadu pokračovat.

**Specifikace:** [[11-ui|11 – plugin-api, app, ui]]

**Navazuje na:** [[M04-persistence]], [[M09-interakce]]

## Úkoly

- [ ] `app/openAppSession` – kompoziční kořen, registrace pluginů a vestavěných handlerů, propojení událostí.
- [ ] `RegenScheduler` (dirty flag, žádná fronta).
- [ ] Akce: undo, redo, smazat vybranou featuru, potlačit, fit all, aktivace nástrojů.
- [ ] `ui/composables`: `useSession` (provide/inject), `useObservable` ([[0010-prezentacni-model|ADR 0010]]).
- [ ] Převod globální klávesnice z DOM na `ViewKeyEvent` pro `ActionRegistry`.
- [ ] Komponenty: `AppShell`, `Toolbar`, `FeatureTree` (stavy, rollback bar tažením, dvojklik = edit, kontextové menu), `FeatureDialog` + `ParamField` registr (`length`, `angle`, `number`, `boolean`, `enum`, `point`), `ViewportHost`, `StatusBar`.
- [ ] Jednoduchý seznam dokumentů (nový, otevřít, smazat).
- [ ] Rozvržení a CSS proměnné.
- [ ] E2E smoke test v Playwright: nový dokument → Box → výška 30 → OK → undo → redo → reload → featura existuje.

## Akceptační kritéria

- Celá cesta *klik → operace → log → regenerace ve workeru → vykreslení → undo* funguje v prohlížeči.
- Po reloadu stránky je dokument i undo historie zpět.
- Chybný parametr (výška 0) → featura červená ve stromu, zbytek modelu v pořádku.
- `ui` neimportuje nic kromě `app`, `core` a typů z `document`/`interaction`.

## Co se naučíš

Vue 3 Composition API, propojení externího stavu s reaktivitou Vue (`shallowRef`, `markRaw`), kompoziční kořen bez DI frameworku.

## Retrospektiva

_(vyplnit po dokončení)_
