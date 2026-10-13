---
type: question
status: open
area: "[[07-regenerace]]"
decide_by: "[[M06-regenerace]]"
proposal: "unknown-handle je chyba programu (assert), jiná chyba nechá množinu na příští sweep, disconnected ji vyprázdní"
decision: ""
tags:
  - otazka
created: 2026-10-13
updated: 2026-10-13
---
# Q040 Selhání release při úklidu handle

**Oblast:** [[07-regenerace]] · **Rozhodnout do:** [[M06-regenerace]]

## Otázka

Mark & sweep v `regen` uvolňuje nepotřebné [[Handle tvaru|handle]] voláním `kernel.release`. Ten je podle [[06-geometricke-jadro#Kontrakt (platí pro každou implementaci)|spec 06]] přísný a atomický: jeden neznámý handle → `'unknown-handle'` a neuvolní se nic. Když se do množiny „vlastněných“ handle dostane neplatný handle (chyba ve sweepu), selže každý další sweep znovu a nic se už neuvolní. Co má [[Regenerace|regenerace]] při odmítnutí `release` dělat? Našla to revize architektury M5.

## Možnosti a návrh

1. **Podle kódu chyby:**
   - `'unknown-handle'` je chyba programu (regen vydal handle, který nevlastní) → `assert`/výjimka, ať se chyba najde.
   - Jiná chyba jádra (`'internal'`) → handle zůstanou ve vlastněné množině, zkusí se při příštím sweepu.
   - `RpcError` `'disconnected'` ([[Q037 Pád workeru a čekající RPC volání|Q037]]) → jádro je pryč, vlastněná množina se vyprázdní (handle už neexistují).
   - \+ Chyby se neschovávají, zotavení po pádu workeru je definované.
   - − Tři větve, tři testy (`failNext('release', …)`).
2. **Tolerantní `release`** (neznámé handle ignorovat) – změna kontraktu jádra.
   - \+ Sweep se nikdy nezasekne.
   - − Skryje chyby ve sweepu, úniky se pak hledají hůř.
3. **Release po jednom handle**, chyby jednotlivě ignorovat.
   - − N volání přes RPC místo jednoho.

Návrh: **1**.

## Rozhodnutí

_(Až se rozhodne: vyplnit sem, nastavit `status: answered` a `decision`, rozhodnutí propsat do specifikace. Zásadní rozhodnutí → nové ADR.)_
