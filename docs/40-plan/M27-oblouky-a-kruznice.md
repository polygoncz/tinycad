---
type: milestone
status: todo
order: 27
aliases:
  - M27
  - M27 Oblouky a kružnice
modules:
  - sketch
  - sketcher
  - ui
specs:
  - "[[12-skicar]]"
  - "[[10-interakce]]"
  - "[[11-ui]]"
depends_on:
  - "[[M26-snapper-a-auto-vazby]]"
started:
finished:
tags:
  - milnik
created: 2026-10-15
updated: 2026-10-15
---
# M27 – Oblouky a kružnice

**Cíl:** kružnice a oblouky jde zadat stejnými způsoby jako ve Fusionu; každý způsob vytvoří odpovídající vazby (tečnost, sdílené body).

**Specifikace:** [[12-skicar#Režim skicáře (sketcher)]], [[10-interakce#Nástroje a akce skicáře]], [[11-ui#Komponenty]]

**Navazuje na:** [[M26-snapper-a-auto-vazby|M26]] – tečné nástroje a výběr křivek používají snapper a inferenci tečnosti.

> [!note] Hrubý plán
> Úkoly a akceptační kritéria se upřesní při startu milníku spolu se specifikací a implementačním plánem.

## Rozsah

Pavel 2026-10-15: „Zadávání oblouků a kružnic různými způsoby (inspiruj se ve Fusion).“

Rozhodnutí v sezení 2026-10-15 (brainstorming), Pavel vybral všechny nabídnuté způsoby:
- **Kružnice:** střed + bod (existuje), 2 body (průměr), 3 body, 2 tečny (ke dvěma křivkám, poloměr myší), 3 tečny.
- **Oblouk:** střed + začátek + konec (existuje), 3 body (začátek, bod na oblouku, konec), tečný z konce existující křivky.
- **Polyline:** tah z posledního bodu přepne na tečný oblouk, pak se pokračuje úsečkami (jako Fusion).
- Datový model se **nemění** (`circle`, `arc`); mění se jen nástroje, výpočet počáteční polohy (opsaná/vepsaná kružnice) a vznikající vazby.
- Nástroje se v liště sdruží do rozbalovacích skupin (Kružnice ▾, Oblouk ▾) jako ve Fusionu.

## Úkoly

- [ ] Upřesnit spec (gesta každého nástroje, vznikající vazby, degenerované případy) a implementační plán
- [ ] Geometrické pomůcky v `sketch` (kružnice ze 3 bodů, tečné kružnice, oblouk ze 3 bodů)
- [ ] Nástroje kružnic
- [ ] Nástroje oblouků
- [ ] Tečný oblouk v polyline
- [ ] Skupiny nástrojů v liště, zkratky, e2e

## Akceptační kritéria

- Každý nástroj vytvoří geometrii, kterou řešič přijme (`'ok'`) a jejíž vazby odpovídají gestu (např. 2 tečny → 2× `tangent`).
- Degenerovaný vstup (tři body na přímce, rovnoběžné tečny bez řešení) nic nevytvoří a nástroj zůstane aktivní.

## Co se naučíš

- Konstrukce kružnic z podmínek (Apolloniova úloha pro tři tečny) a proč ji v CAD stačí odhadnout a dořešit řešičem.

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Průběh stopy

_(Souběžná stopa, [[Roadmapa#Souběžné stopy (pokus od M25)|pravidla]]: místo deníku sem zapisuje průběh; hlavní sezení ho při sloučení přenese do deníku.)_

## Retrospektiva

_(vyplnit po dokončení; obecné poznatky přesunout do `70-poznatky/`)_
