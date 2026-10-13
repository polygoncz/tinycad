---
type: insight
status: seed
aliases:
  - Strukturální typování a porty
  - Structural typing ports
topics:
  - TypeScript
  - architektura
sources:
  - https://www.typescriptlang.org/docs/handbook/type-compatibility.html
  - https://developer.mozilla.org/en-US/docs/Web/API/MessagePort/start
  - https://nodejs.org/api/worker_threads.html#class-messageport
tags:
  - poznatek
created: 2026-10-13
updated: 2026-10-13
---
# Port bez adaptéru díky strukturálnímu typování

**Shrnutí:** v TypeScriptu stačí, aby doména definovala vlastní minimální rozhraní toho, co od platformy potřebuje. Skutečný objekt platformy ho splní svým tvarem, bez adaptéru a bez toho, aby doména znala typy platformy. Test proti skutečnému objektu je pak důkazem, že rozhraní sedí.

## Podrobnosti

- TS porovnává typy podle tvaru, ne podle jména nebo dědičnosti. Rozhraní `MessageEndpoint { postMessage; addEventListener; start? }` splní `MessagePort` v prohlížeči i v Node, `Worker` i globální scope workeru. V C++ by to vyžadovalo šablonu nebo obalovou třídu.
- Doména typovaná bez DOM (`"lib": ["ES2023"]`) tak dostane platformu, aniž by ji znala. Stejně funguje injekce funkce: `RandomSource = (bytes) => void`, kam `app` předá `crypto.getRandomValues.bind(crypto)`.
- **Přetížení metod jsou past.** `MessagePort.postMessage` má dvě přetížení a v tom s polem k přenosu je `transfer` povinný. Vlastní rozhraní s volitelným `transfer?` na port nepasovalo. Odhalil to až typecheck testu, který předal skutečný `MessagePort`.
- **Chování, které typy neukážou:** `MessagePort` při použití `addEventListener` nedoručí nic, dokud se nezavolá `start()` (`onmessage` ho volá sám). Proto má rozhraní volitelné `start?()`.
- `readonly` u indexové signatury TS při přiřazení nehlídá, takže `readonly [number, number, number]` projde do parametru typu `{ [n: number]: number }`. Ověřit překladem je spolehlivější než úvaha.

## Jak to využívá tinycad

`core/rpc` a generátor ID podle [[Q022 Platformové typy v core]], v souladu s [[0009-platformove-nezavisla-domena|ADR 0009]]. Obecný vzor je [[Port a adaptér]], specifikace v [[02-core]].

## Zdroje

- TypeScript Handbook: Type Compatibility.
- MDN: `MessagePort.start()`.
- Node.js: `worker_threads`, třída `MessagePort`.
