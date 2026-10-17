---
type: milestone
status: todo
order: 48
aliases:
  - M48
  - M48 Hlášení v UI
modules:
  - app
  - ui
  - sketcher
  - interaction
specs:
  - "[[11-ui]]"
  - "[[14-protokol]]"
depends_on:
  - "[[M47-uklid-a-dokonceni]]"
started:
finished:
tags:
  - milnik
created: 2026-10-17
updated: 2026-10-17
---
# M48 – Hlášení v UI

**Cíl:** Klient má kanál dočasných hlášení (`AppSession.notice`) a toast, takže uživatel uvidí ztrátu transakce, zamítnutou skicu a výpadek serveru (N134).

> Hrubý plán (2026-10-17) z Pavlových rozhodnutí sporných míst ([[Rozhodnutí nativního jádra#Pavlova rozhodnutí sporných míst (2026-10-17)]]). Před zahájením upřesnit úkoly, kontrakt a Implementační plán.

**Specifikace:** [[11-ui]], [[14-protokol]]

**Navazuje na:** [[M47-uklid-a-dokonceni]]

## Úkoly

- [ ] Kontrakt `AppSession.notice` (druh, klíč překladu, parametry, trvání) ve spec 11; toast v `ui` (fronta, zavření, přístupnost).
- [ ] Zdroje hlášení: ztráta transakce po restartu serveru (`lost`), `SKETCH_NOT_SOLVED` ve skicáři (klíč `sketch.notSolved`), zahozená změna (`onError`), server nedostupný a obnovené spojení.
- [ ] Úklid stavů, které serverová cesta nenastaví (N144: `RegenUiState.failed`, `KernelUiState 'failed'`, varování „export bez historie“).
- [ ] E2E: restart jádra uprostřed dialogu ukáže hlášení; zamítnutá skica ukáže hlášení.

## Akceptační kritéria

- Ztráta transakce, zamítnutá skica a výpadek serveru jsou vidět v UI, ne jen v konzoli.
- `npm run check` a `test:e2e` zelené.

## Co se naučíš

Jak oddělit dočasná hlášení od trvalého stavu UI a jak je napojit na asynchronní události ze serveru.

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Retrospektiva

_(vyplnit po dokončení; obecné poznatky přesunout do `70-poznatky/`)_
