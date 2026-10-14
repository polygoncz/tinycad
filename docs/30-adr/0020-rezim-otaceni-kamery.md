---
type: adr
status: accepted
number: 20
aliases:
  - ADR 0020
  - Režim otáčení kamery
date: 2026-10-14
related:
  - "[[0019-vlastni-ovladani-kamery]]"
  - "[[09-vykreslovani]]"
  - "[[11-ui]]"
  - "[[M17.1-rezim-otaceni]]"
supersedes:
tags:
  - adr
created: 2026-10-14
updated: 2026-10-14
---
# 0020 – Režim otáčení kamery: turntable a volný

- **Stav:** Přijato (`status: accepted`, Pavel 2026-10-14)
- **Datum:** 2026-10-14
- **Souvisí:** [[0019-vlastni-ovladani-kamery|ADR 0019]], [[09-vykreslovani#Kamera]], [[11-ui]], [[M17.1-rezim-otaceni|M17.1]]

## Kontext

[[0019-vlastni-ovladani-kamery|ADR 0019]] zavedl vlastní ovládání kamery s **volnou** rotací (trackball) a roll šipkami na view cube. Po vyzkoušení v [[M17-kamera-a-view-cube|M17]] chce Pavel, aby osa Z při otáčení zůstávala svislá, jak je zvykem v mnoha CAD. Volnou rotaci ale nechce zahodit úplně, má jít nastavit.

ADR 0019 se nepřepisuje. Toto ADR ho doplňuje: vlastní ovládání, stav kamery (`target`, `orientation`, `halfHeight`) i animace platí dál, mění se jen to, že rotace má dva režimy.

## Rozhodnutí

- **`OrbitMode = 'turntable' | 'free'`, výchozí `turntable`.**
  - `turntable`: nulový roll (osa `right` kamery je vždy vodorovná). Orbit otáčí kolem světové osy Z a kolem `right`, elevace je oříznutá na ⟨−90°, +90°⟩. Roll šipky view cube jsou skryté.
  - `free`: chování z ADR 0019.
- Režim je **parametr čistých operací** (`orbit`, `turn` v `camera-ops`), ne druhý rig.
- Přepnutí do `turntable` animovaně srovná kameru (`levelOrientation`): směr pohledu zůstane a nahoru přijde Z.
- **Předvolba stránky, ne dokumentu.** Zdroj pravdy je `ui`, uložení v `localStorage` (`tinycad.orbitMode`), stejně jako téma a jazyk. Tlačítko u view cube jen ohlásí požadavek (`render` → `app` → `ui`). `ui` stav přepne a pošle ho zpět přes `AppSession.setOrbitMode`.

## Zvažované alternativy

- **Jen turntable, roll šipky pryč.** Nejjednodušší řešení, ale Pavel chce volnou rotaci zachovat jako volbu.
- **Turntable a roll šipky zároveň.** Roll by rozbil invariant „Z nahoru“ a další orbit by se choval nekonzistentně. Zamítnuto.
- **Stav režimu přímo v `render`.** Kratší tok, jenže `render` nesmí na úložiště a vznikly by dva zdroje pravdy, které se musí synchronizovat. Zamítnuto.
- **Přepínač v titulkové liště nebo v toolbaru.** Titulková lišta je daleko od kamery. Toolbar by potřeboval přepínací akci v `ActionRegistry`. Pavel zvolil tlačítko u view cube, jako má Onshape menu u cube.

## Důsledky

- (+) Výchozí chování odpovídá zvyku z CAD (Z nahoru), volná rotace je na jedno kliknutí.
- (+) Matematika obou režimů je čistá a testovatelná v Node. Invariant turntable (`right · Z = 0`) se dá testovat přímo.
- (−) Tok „tlačítko → událost → `ui` → zpět do `render`“ má víc kroků než přímé přepnutí v `render`. Je to cena za jeden zdroj pravdy.
- (−) Popisky view cube mají dva klíče navíc (`switchToFree`, `switchToTurntable`).
