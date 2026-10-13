---
type: insight
status: seed
aliases:
  - Worker s pomalou inicializací
  - ready jako metoda RPC
topics:
  - web workery
  - asynchronní programování
  - architektura
sources:
  - https://developer.mozilla.org/en-US/docs/Web/API/Worker/error_event
  - https://developer.mozilla.org/en-US/docs/Web/API/Window/unhandledrejection_event
tags:
  - poznatek
created: 2026-10-13
updated: 2026-10-13
---
# Start workeru bez ztráty zpráv

**Shrnutí:** Worker s pomalou asynchronní inicializací (WASM) si posluchače zpráv registruje hned synchronně a každé volání čeká na promise inicializace; klient čeká na explicitní metodu `ready`, přes kterou se k němu dostane i selhání startu.

## Podrobnosti

- **Ztracené zprávy:** modulový worker s `await init()` nahoře zpracovává zprávy už během čekání. Zpráva, která dorazí dřív, než existuje posluchač, se zahodí. Proto: posluchač (`serveRpc`) hned, inicializace za ním jako `Promise`, každá metoda nejdřív `await` na ni.
- **Selhání startu:** odmítnutý `Promise` ve workeru nespustí `worker.onerror` (ten chytá jen neodchycené výjimky a selhání načtení skriptu). Metoda `ready` v protokolu ho doručí klientovi jako obyčejné odmítnutí s kódem chyby.
- **Neošetřené odmítnutí:** selhaná inicializace, na kterou se zatím nikdo neptá, by se nahlásila jako „unhandled rejection“. Druhý `promise.catch(() => undefined)` ji označí za ošetřenou; každé další `await` přesto odmítne.
- **Dvě cesty selhání:** chyba inicializace → odmítnutí `ready`; worker, který vůbec nenaběhne (404, chyba skriptu) → `onerror` → `failAll` → všechna volání `'disconnected'`.
- **Testovatelnost:** strana workeru přijímá `Promise<Port>` (rozhraní), takže čekání a selhání startu jdou testovat přes `MessageChannel` v Node s fake implementací, bez skutečného workeru.

## Jak to využívá tinycad

[[06-geometricke-jadro#Start workeru a `ready`|Spec 06]]: `occt.worker.ts` volá `serveRpc(createOcctWorkerImpl(loadOcct().then(…)))`, `createOcctKernel()` čeká na `ready` a při selhání worker ukončí. Pád spojení řeší [[Q037 Pád workeru a čekající RPC volání|Q037]] a [[02-core#RPC pro workery|RPC v core]].

## Zdroje

- https://developer.mozilla.org/en-US/docs/Web/API/Worker/error_event
- https://developer.mozilla.org/en-US/docs/Web/API/Window/unhandledrejection_event
