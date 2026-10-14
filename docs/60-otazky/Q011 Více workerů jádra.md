---
type: question
status: answered
area: "[[06-geometricke-jadro]]"
decide_by: "[[M15-export-a-dokonceni]]"
proposal: "Zatím jeden worker"
decision: "jeden worker jádra; víc workerů jen při naměřené potřebě (Další nápady M15)"
tags:
  - otazka
created: 2026-10-12
updated: 2026-10-14
---
# Q011 Více workerů jádra

**Oblast:** [[06-geometricke-jadro]] · **Rozhodnout do:** [[M15-export-a-dokonceni]]

## Otázka

Spouštět víc workerů paralelně (např. tessellace odděleně od modelování)?

## Možnosti a návrh

Vyžaduje sdílení tvarů mezi workery – zatím ne.

## Rozhodnutí

2026-10-14 (noční rychloakce, [[Rozhodnutí noční rychloakce#M15 – Export a dokončení|R134]]): **Jeden worker.** Tvary žijí v paměti jednoho WASM modulu a handle platí jen v jeho instanci ([[06-geometricke-jadro#Handle místo tvarů]]); druhý worker (např. na tessellaci) by potřeboval přenos tvarů (BREP) mezi moduly, tedy přesně tu cenu, kterou má ušetřit. Worker zpracovává požadavky sériově a měření M15 (Ú6) ukáže, zda tessellace vůbec brzdí. Víc workerů je v [[M15-export-a-dokonceni#Další nápady (mimo rozsah)|Další nápady]]. Ve specifikaci se nic nemění.
