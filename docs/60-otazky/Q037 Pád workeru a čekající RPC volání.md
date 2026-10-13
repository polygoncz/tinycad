---
type: question
status: answered
area: "[[02-core]]"
decide_by: "[[M05-kernel-port]]"
proposal: "RpcClient.dispose a failAll: čekající volání se odmítnou kódem 'disconnected'; adaptér napojí worker.onerror"
decision: "RpcClient.dispose a failAll s kódem disconnected; implementace v M7"
tags:
  - otazka
created: 2026-10-13
updated: 2026-10-13
---
# Q037 Pád workeru a čekající RPC volání

**Oblast:** [[02-core]] · **Rozhodnout do:** [[M05-kernel-port]]

## Otázka

`createRpcClient` z `core` neumí odmítnout čekající volání. Když worker spadne (chyba při načtení skriptu, neodchycená výjimka) nebo se ukončí (`dispose` → `terminate()`), promisy čekajících volání **visí navždy**. Revize architektury M4 to našla u persistence: `PersistenceService.flush()` by visel a všechny další flushe se řetězí za něj, takže se nic neuloží a stav zůstane `pending`, ne `error`. Totéž čeká na jádro OCCT ve workeru ([[0002-occt-wasm-ve-workeru|ADR 0002]]). Jak to řešit?

## Možnosti a návrh

1. **`RpcClient` dostane `dispose()` / `failAll(error)`.** Čekající volání se odmítnou `RpcError` s kódem `'disconnected'`, nová volání po `dispose` taky. Adaptér (`createIdbDocumentStore`, `createOcctKernel`) napojí `worker.onerror` a `messageerror` na `failAll` a `dispose` na `dispose`.
   - \+ Jedno řešení pro všechny workery, testovatelné v Node přes `MessageChannel`.
   - − Změna API `core` (prstenec 1).
2. **Timeout na volání** v `RpcClient`.
   - \+ Pokryje i zaseknutý (ne spadlý) worker.
   - − Operace jádra trvají libovolně dlouho, timeout se těžko volí; s [[Q010 Zrušení probíhající operace jádra|Q010]] se to kříží.
3. **Řešit jen v adaptéru** (vlastní mapa čekajících volání).
   - − Duplicita pro každý worker.

Návrh: **1**, případně později doplnit 2 pro jádro. Rozhodnout do [[M05-kernel-port|M5]], protože tam vzniká druhý worker. Persistence ve workeru se v prohlížeči poprvé spustí až v M10.

## Rozhodnutí

2026-10-13: **Varianta 1**, implementace v [[M07-kernel-occt|M7]] spolu s workerem jádra (M5 je port bez workeru). `RpcClient` dostane `dispose()` a `failAll(error)`: čekající i pozdější volání se odmítnou `RpcError` s kódem `'disconnected'`. Adaptéry (`createIdbDocumentStore`, `createOcctKernel`) napojí `worker.onerror`/`messageerror` na `failAll` a `dispose` na `dispose`. Úkol je v [[M07-kernel-occt]], kontrakt doplní [[02-core#RPC pro workery]].
