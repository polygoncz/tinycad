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

## Doplněk 2026-10-14: příčina pádu po ~262 000 výjimkách ([[M19.1-opravy-z-revize|M19.1]])

[[Revize kódu 2026-10-14]] podezírala z pádu neuvolněné výjimky, protože adaptér nevolal `decrementExceptionRefcount`. Úkol Ú5 v M19.1 změřil, že skutečná příčina je jinde:

- **Zásobník Emscriptenu.** Výjimka C++, která doletí do JS, nechá `__stack_pointer` posunutý o 32 B, protože epilogy funkcí po cestě neproběhnou. Zásobník má 8 MiB, takže 8 MiB / 32 B = 2^18 = 262 144 výjimek. Pád nastal deterministicky po 262 172 výjimkách ve všech variantách (s `decrement` i bez, s větší haldou). S ručním `stackRestore` po každém volání prošlo 400 000 výjimek bez pádu.
- **Halda.** Neuvolněná výjimka stojí asi 140 B haldy. To M19.1 opravilo (`decrementExceptionRefcount` v `occtExceptionText`). Na pád to ale vliv nemá.
- **Proč to neopravujeme hned.** Build `replicad-opencascadejs` nevystavuje `stackSave` / `stackRestore`, jen minifikované exporty dostupné přes `instantiateWasm`, což je křehké.
- **Co platí do té doby.** Pád po ~262 000 výjimkách zachytí restart jádra (varianta A, od M19.1 hlášený přes `onDisconnected` a s posuvným oknem). Trvalé řešení je vlastní build ([[M16-vlastni-occt-build]]) s exportem `stackRestore`, nebo počítání výjimek v workeru a restart předem.
