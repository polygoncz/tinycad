---
type: question
status: answered
area: "[[06-geometricke-jadro]]"
decide_by: "[[M10-ui]]"
proposal: "Trap WASM hlásit jako konec jádra (failAll, 'disconnected'); restart jádra řeší app"
decision: "Varianta A v M10: trap je fatální, worker ho nahlásí, klient přejde na disconnected, app vytvoří nové jádro a spustí regeneraci."
tags:
  - otazka
created: 2026-10-13
updated: 2026-10-13
---
# Q055 Pád WASM jádra

**Oblast:** [[06-geometricke-jadro]] · **Rozhodnout do:** [[M10-ui]]

## Otázka

Revize [[M07-kernel-occt|M7]] našla: když WASM spadne na úrovni stroje (`WebAssembly.RuntimeError` – trap, `unreachable`, „function signature mismatch“), `toKernelError` z něj udělá běžnou chybu `'internal'`. `regen` pak označí featuru jako chybnou a s jádrem pracuje dál, přestože jeho paměť může být poškozená. Revizor pád vyvolal opakovanými výjimkami OCCT s `getExceptionMessage` (~524 000 výjimek). Výjimka OCCT (`WebAssembly.Exception`) je naopak řízená a jádro po ní funguje.

## Možnosti a návrh

| Varianta | Pro | Proti |
|---|---|---|
| **A: trap = konec jádra.** Worker po `WebAssembly.RuntimeError` odpoví kódem, který klient převede na `failAll` → `'disconnected'`; `regen` zahodí cache a handle ([[Q049 Pád jádra během regenerace\|Q049]]), `app` vytvoří nové jádro | využije existující cestu pro pád jádra, žádný poškozený stav | nový kód v protokolu; restart jádra v `app` |
| B: nechat `'internal'`, jen zapsat riziko | žádná práce | poškozené jádro může vracet nesmysly |
| C: řešit až s [[M16-vlastni-occt-build]] | vlastní build může traps omezit | do té doby riziko trvá |

Návrh: **A**, implementovat s napojením jádra v [[M10-ui]] (tam vzniká `app` a restart jádra). Do té doby spec 06 říká, že stav jádra po trapu není zaručený.

## Rozhodnutí

2026-10-13 (Pavel): **varianta A v [[M10-ui]].** Vlastní build ([[M16-vlastni-occt-build]]) trapy jen omezí (nativní výjimky, větší zásobník), neodstraní, takže cesta restartu je potřeba tak jako tak. Propsáno do [[06-geometricke-jadro]] a [[11-ui]].
