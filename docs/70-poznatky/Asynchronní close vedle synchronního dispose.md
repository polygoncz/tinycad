---
type: insight
status: seed
aliases:
  - close a dispose
topics:
  - životní cyklus zdrojů
  - architektura
sources:
  - https://github.com/tc39/proposal-explicit-resource-management
  - https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API
tags:
  - poznatek
created: 2026-10-13
updated: 2026-10-13
---
# Asynchronní close vedle synchronního dispose

**Shrnutí:** Zdroj s asynchronním úklidem (dopsat frontu, pak pustit zámek) potřebuje dvě operace: `close(): Promise` pro zdvořilé zavření, na které se čeká, a synchronní `dispose()` jako pojistku, kterou jde zavolat kdykoli.

## Podrobnosti

- `dispose()` musí jít zavolat i při chybě nebo z kódu, který nemůže čekat (`using`, odpojení komponenty). Proto nečeká – jen spustí úklid.
- `close()` vrací promise, který se splní až po posledním zápisu. Volající, kterému záleží na pořadí (přepnutí dokumentu: zavřít starý, pak otevřít nový), na něj čeká. Druhé volání vrací tentýž promise.
- **Pořadí uvolnění** se řídí závislostmi: nejdřív to, co zapisuje (session, fronta), pak to, kam se zapisuje (store, worker), nakonec zámek, který chrání ostatní před souběžným zápisem.
- Obejití „počkáme, až zápis určitě začne“ (odložený úklid, počítání běžících volání) funguje jen díky detailu plánovače a časem se rozbije – lepší je explicitní promise.
- Hot reload ve vývoji je stejný případ: stará instance musí zavřít a nová počkat, jinak najde zámek obsazený.

## Jak to využívá tinycad

`AppSession.close()`/`dispose()`/`flush()` a `openAppSession` ([[11-ui]], Kompoziční kořen – Zavření), [[Spolehlivé ukládání na pozadí]], [[Vlastnictví zdrojů mimo GC]].

## Zdroje

- TC39 Explicit Resource Management (`Disposable`, `AsyncDisposable`).
- MDN: Web Locks API.
