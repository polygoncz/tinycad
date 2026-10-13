---
type: question
status: answered
area: "[[02-core]]"
decide_by: "[[M01-core]]"
proposal: "Vlastní strukturální typy v core, náhodnost a logování injektovat"
decision: "Vlastní strukturální typy a injekce (možnost 1)"
tags:
  - otazka
created: 2026-10-13
updated: 2026-10-13
---
# Q022 Platformové typy v core

**Oblast:** [[02-core]] · **Rozhodnout do:** [[M01-core]]

## Otázka

Specifikace [[02-core]] počítá s typy a globály, které v `tsconfig.domain.json` (`"lib": ["ES2023"]`, bez DOM, viz [[0009-platformove-nezavisla-domena|ADR 0009]]) neexistují. Ověřeno překladem: chybí `console`, `crypto`, `MessageEvent`, `MessagePort` a `Transferable`.

Kde to v `core` naráží:

- `createRandomIdGenerator` volá `crypto.getRandomValues`.
- `Emitter` má výjimku v handleru „zalogovat“, tedy `console.error`.
- `core/rpc`: `MessageEndpoint` používá `MessageEvent` a `Transferable`.

Jak má `core` tyto závislosti na platformě dostat, aniž by porušil ADR 0009?

## Možnosti a návrh

1. **Vlastní strukturální typy a injekce** ([[Port a adaptér]] v malém).
   - RPC: `core` definuje vlastní minimální tvary, např. `MessageEndpoint { postMessage(msg: unknown, transfer?: readonly ArrayBuffer[]): void; addEventListener(type: 'message', fn: (e: { readonly data: unknown }) => void): void }`. Skutečný `MessagePort` i `Worker` ho splní strukturálně, takže `app` předá port bez adaptéru.
   - ID: `createRandomIdGenerator(random: (bytes: Uint8Array) => void)`. `app` předá `crypto.getRandomValues.bind(crypto)`.
   - Emitter: chyby z handlerů nelogovat v `core`, ale předat ven (viz návrh níže). Asynchronní přehození přes `queueMicrotask`/`setTimeout` nejde, ani ty v ES lib nejsou.
   - \+ Doména zůstane čistě ES2023, testy můžou injektovat deterministický zdroj. + Výukově přesné: přesně to je port.
   - − Trochu víc parametrů; `Transferable` se zúží na `ArrayBuffer` (pro nás stačí: sítě a buffery).
2. **Úzká ambientní deklarace v `core`** (`declare const console: { error(...a: unknown[]): void }` apod. v jednom souboru `core/platform.d.ts`).
   - \+ Méně parametrů, kód vypadá jako „normální“ TS.
   - − Obchází ADR 0009: doména tiše předpokládá prostředí s těmi globály. Je to otvor, kterým by šlo propašovat cokoli dalšího.
3. **Přidat `lib: WebWorker` jen pro `core/rpc`** (samostatný tsconfig nebo výjimka cestou jako `persistence/idb`).
   - \+ Pravé typy z prohlížeče.
   - − `rpc` se stane platformovým adaptérem v prstenci 1, přestože je sdílený doménou (persistence, jádro). Další konfigurace k udržování.

Návrh: **1**. Pro `Emitter` povinný `onError` není hezký pro testy, proto: konstruktor bez argumentu chybu z handleru zachytí, dokončí ostatní handlery a **pak první zachycenou chybu vyhodí** z `emit` (`AggregateError`, když jich je víc). Logování si pak udělá volající, který zná platformu. Tím odpadá potřeba `console` úplně a pravidlo „výjimka neshodí ostatní handlery“ zůstává splněné.

## Rozhodnutí

2026-10-13: **možnost 1** včetně návrhu pro `Emitter`. `core` zůstává čistě ES2023: RPC má vlastní strukturální `MessageEndpoint`, buffery k přenosu jsou `ArrayBuffer`, zdroj náhody dostává `createRandomIdGenerator` parametrem a `Emitter` chyby z handlerů neloguje, ale po zavolání všech handlerů je vyhodí z `emit`. Upřesňuje [[0009-platformove-nezavisla-domena|ADR 0009]], nové ADR není potřeba. Propsáno do [[02-core]].
