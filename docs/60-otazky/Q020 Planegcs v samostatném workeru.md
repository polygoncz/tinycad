---
type: question
status: answered
area: "[[12-skicar]]"
decide_by: "[[M12-skicar]]"
proposal: "Samostatný worker"
decision: "Samostatný worker přes core/rpc, adaptér v modulu solver-planegcs, port ConstraintSolver v modulu sketch (ADR 0016)"
tags:
  - otazka
created: 2026-10-12
updated: 2026-10-14
---
# Q020 Planegcs v samostatném workeru

**Oblast:** [[12-skicar]] · **Rozhodnout do:** [[M12-skicar]]

## Otázka

Spouštět řešič vazeb planegcs v samostatném workeru, nebo ve workeru jádra?

## Možnosti a návrh

Samostatný je čistší – nezávislé selhání, paralelismus. Ověřit při integraci.

## Rozhodnutí

Rozhodnuto 2026-10-14 (noční rychloakce, [[Rozhodnutí noční rychloakce#M12 – Skicář|R31]]): **samostatný worker** přes `core/rpc`, adaptér v novém modulu `solver-planegcs` (prstenec 3), port `ConstraintSolver` v doménovém modulu `sketch` ([[0016-planegcs-resic-vazeb|ADR 0016]], [[0017-modul-sketch-a-skicar|ADR 0017]]). Aplikaci skládá `app` (kompoziční kořen).

Proč, i když řešení obdélníku trvá pod 1 ms: velká skica (100 obdélníků ~34 ms) by zasekla UI, OOM řešiče (pevná paměť 21 MiB) by v hlavním vlákně poškodil modul, worker jádra zpracovává požadavky sériově (dlouhý boolean by blokoval tažení) a vzor workeru s RPC a testem v Node v repu je (`kernel-occt`, [[06-geometricke-jadro#Start workeru a `ready`]]). Cena: asynchronní tažení s frontou (jeden rozpracovaný a jeden čekající cíl). Propsáno do [[12-skicar#Řešič vazeb]].
