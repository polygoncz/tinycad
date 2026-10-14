---
type: moc
status: active
aliases:
  - Plán
  - Roadmap
tags:
  - plan
created: 2026-10-12
updated: 2026-10-14
---
# Roadmapa

Stavíme **odspodu nahoru**: nejdřív vrstvy bez závislostí, každá hotová a otestovaná, než na ní postavíme další. Prvních sedm milníků (M0–M6) běží celé v Node bez prohlížeče a bez OCCT – ověřujeme na nich architekturu. Od M7 přibývá skutečná geometrie, od M8 obraz a v M10 je první použitelná aplikace.

Jediná entita až do M10 je **kvádr (Box)**. Druhá entita v M11 je zkouška rozšiřitelnosti.

## Přehled

| Milník | Název | Moduly | Výsledek |
|---|---|---|---|
| [[M00-zaklad-projektu\|M0]] | Základ projektu | – | Vite + TS + Vue + Vitest + lint, kontrola hranic modulů |
| [[M01-core\|M1]] | Core | `core` | ID, události, Disposable, Result, matematika, RPC |
| [[M02-dokument\|M2]] | Doménový model | `document` | CadDocument, featury, schémata, serializace |
| [[M03-operace\|M3]] | Operace a historie | `ops` | dispečer, log, transakce, undo/redo, replay test |
| [[M04-persistence\|M4]] | Persistence | `persistence` | IndexedDB ve workeru, snapshoty, načtení |
| [[M05-kernel-port\|M5]] | Port jádra | `kernel` | `GeometryKernel`, `FakeKernel`, kontraktové testy |
| [[M06-regenerace\|M6]] | Regenerace | `regen`, `plugin-api`, `features/box` | Regenerator s cache, rollback, chyby, Box plugin |
| [[M07-kernel-occt\|M7]] | OCCT adaptér | `kernel-occt` | skutečné OCCT ve workeru, tessellace |
| [[M08-vykreslovani\|M8]] | Vykreslování | `render` | viewport, synchronizace, picking |
| [[M09-interakce\|M9]] | Interakce | `interaction` | výběr, nástroje, dialog featury, akce |
| [[M10-ui\|M10]] | UI a první aplikace | `app`, `ui` | **spustitelná aplikace s kvádrem**, strom, dialog, undo, ukládání |
| [[M10.1-zpevneni-kostry\|M10.1]] | Zpevnění kostry | `document`, `ops`, `regen`, `interaction`, `render`, `app` | opravy z [[Revize architektury 2026-10-13\|revize architektury]]: artefakty, identita tělesa, reference, migrace v logu, filtr pickingu |
| [[M11-dalsi-entity\|M11]] | Další entity | `features/*` | Cylinder, Transform, Boolean; reference na tělesa |
| [[M12-skicar\|M12]] | Skicář | `features/sketch` | skica, vazby (planegcs), profily |
| [[M13-extrude-revolve\|M13]] | Extrude a Revolve | `features/*` | tělesa ze skici |
| [[M14-topologicke-pojmenovani\|M14]] | Topologické pojmenování | `regen`, `kernel-occt` | fillet, chamfer, skica na ploše, stabilní reference |
| [[M15-export-a-dokonceni\|M15]] | Export a dokončení | `kernel-occt`, `ui` | STEP export, import/export dokumentu |
| [[M16-vlastni-occt-build\|M16]] | Vlastní OCCT build | `kernel-occt` | vlastní C++ modul přes Emscripten místo předpřipraveného buildu |
| [[M17-kamera-a-view-cube\|M17]] | Kamera a view cube | `core`, `render`, `app`, `ui` | kamera bez ořezávání, vlastní ovládání, view cube jako v Onshape |
| [[M17.1-rezim-otaceni\|M17.1]] | Režim otáčení | `render`, `app`, `ui` | turntable (Z nahoru) jako výchozí, volná rotace přepínatelná u view cube |
| [[M18-manipulatory\|M18]] | Manipulátory | `regen`, `interaction`, `plugin-api`, `render`, `app`, `ui`, `features/*` | úchyty ve viewportu: posun a rotace Transformace, vzdálenost Extrude; obecná abstrakce přes kotvy z regenerace ([[0021-manipulatory-kotvy-z-regenerace\|ADR 0021]]) |
| [[M19-manipulator-fusion\|M19]] | Manipulátor ve stylu Fusion | `interaction`, `render`, `app`, `ui`, `features/*` | šipky, čtverce, oblouky a střed; lišta režimů (Volný, Posun, Rotace, Nastavit pivot), pole hodnoty; rotace jako tři úhly ([[0022-rezimy-a-hud-manipulatoru\|ADR 0022]]) |
| [[M19.1-opravy-z-revize\|M19.1]] | Opravy z revize kódu | `core`, `ops`, `document`, `persistence`, `kernel-occt`, `interaction`, `app`, `ui`, `features/*` | ověřené chyby z [[Revize kódu 2026-10-14\|revize kódu]] (menu, rollback bar, validace zápisu, pád jádra, výjimky OCCT) a viditelné chyby v UI |

**Noční rychloakce 2026-10-14:** [[M11-dalsi-entity|M11]]–[[M15-export-a-dokonceni|M15]] implementovány bez průběžného schvalování, rozhodnutí v [[Rozhodnutí noční rychloakce]]. M16 se nedělá – předpřipravený build stačil na celou první verzi.

Stav milníků (`todo` / `doing` / `done`) je **jen ve vlastnostech** souborů milníků – tabulka níže se z nich generuje sama:

![[milniky.base#Přehled]]

## Závislosti milníků

```
M0 → M1 → M2 → M3 ─┬─► M4 ────────────────────────┐
                   │                              │
          M1 → M5 ─┴─► M6 ─► M7 ─► M8 ─► M9 ─► M10 ─► M10.1 ─► M11 ─► M12 ─► M13 ─► M14 ─► M15 ─► M16
                                                                                             └─► M17 ─► M17.1 ─► M18 ─► M19 ─► M19.1
```

M4 (persistence) a M5 (port jádra) na sobě nezávisí – pořadí lze prohodit. Persistence je dřív, protože ověří formát logu, dokud je čerstvý.

Milník `MNN.X` je neplánovaná úprava mezi dvěma milníky ([[Konvence vaultu#Principy|konvence]]); M10.1 nese opravy z revize architektury po M10.

M16 (vlastní OCCT build) technicky potřebuje jen M7. Na konci je proto, že předpřipravený build stačí. Přesune se dřív, pokud mu bude chybět API ([[0013-replicad-opencascadejs|ADR 0013]]).

## Jak pracovat s milníkem

1. Při zahájení nastav ve vlastnostech milníku `status: doing` a `started`. Přečti si soubor milníku a odkazované specifikace. U milníků označených „hrubý plán“ nejdřív upřesni úkoly a akceptační kritéria (a případně specifikaci).
2. Úkoly plň v uvedeném pořadí, po každém spusť `npm run check`.
3. Po dokončení zaškrtni úkol. Odchylky od specifikace propiš do specifikace.
4. Milník je hotový, když platí všechna akceptační kritéria. Pak nastav ve vlastnostech milníku `status: done` a `finished`.
5. Na konci milníku krátká retrospektiva v souboru milníku: co bylo jinak, než se čekalo. Co stojí za zapamatování obecně, zapiš jako [[Konvence vaultu#Poznatky|poznatek]].
