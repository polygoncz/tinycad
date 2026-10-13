---
type: question
status: answered
area: "[[06-geometricke-jadro]]"
decide_by: "[[M05-kernel-port]]"
proposal: "Kód jako data: kernelErrorCode(e) jako u persistence; KernelError zůstane jen jako továrna"
decision: "Kód jako data: kernelErrorCode a createKernelError, kódy malými písmeny"
tags:
  - otazka
created: 2026-10-13
updated: 2026-10-13
---
# Q039 Chyby jádra přes hranici workeru

**Oblast:** [[06-geometricke-jadro]] · **Rozhodnout do:** [[M05-kernel-port]]

## Otázka

Spec 06 říká, že `KernelError` zůstává třída, „protože se rozpoznává přes `instanceof`“. V [[M04-persistence|M4]] se ale ukázalo, že přes `postMessage` třída chyby nepřežije, dorazí jen `RpcError` se stejným `code` (viz [[Kontraktové testy portu]]). `regen` by pak u [[Geometrické jádro|jádra]] ve workeru `instanceof KernelError` nikdy nepoznal. Jak má volající chybu jádra rozpoznat?

## Možnosti a návrh

1. **Kód jako data, stejně jako persistence:** `kernelErrorCode(e): KernelErrorCode | undefined`, chyby vytváří `createKernelError(code, message)`. Třída se ven neexportuje.
   - \+ Jeden vzor v celém projektu, funguje v paměti i přes RPC, kontraktové testy jsou stejné pro fake i OCCT.
   - − Odchylka od spec 06 a od výjimky v [[0011-programovani-proti-rozhranim|ADR 0011]].
2. **Klient převádí:** `OcctKernelClient` zachytí `RpcError` a vyhodí znovu `KernelError` se stejným kódem.
   - \+ Volající dál používá `instanceof`.
   - − Převod v každém klientovi, snadno se zapomene; `RpcError` s jiným kódem (`internal`, `unserializable`) musí taky na něco převést.
3. **Obojí:** klient převádí a k tomu `kernelErrorCode`.
   - − Dva způsoby na totéž.

Návrh: **1**. Zároveň sjednotit styl kódů s persistencí (`'invalid-input'`, `'operation-failed'`, `'unknown-handle'`, `'internal'` místo velkých písmen).

## Rozhodnutí

2026-10-13: **Varianta 1.** Třída `KernelError` se ven neexportuje. Chyby vytváří `createKernelError(code, message)` a rozpoznává `kernelErrorCode(e)`, stejně jako u persistence. Kódy: `'invalid-input'`, `'operation-failed'`, `'unknown-handle'`, `'internal'`. Výjimka z [[0011-programovani-proti-rozhranim|ADR 0011]] pro `KernelError` tím odpadá. Propsáno do [[06-geometricke-jadro#Chyby]] a [[07-regenerace]].
