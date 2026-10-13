---
type: question
status: dropped
area: "[[06-geometricke-jadro]]"
decide_by: "[[M07-kernel-occt]]"
proposal: "Před měřením zaplnit haldu přes ___libc_malloc, pak únik nad ~64 kB celkem zvětší paměť"
decision: "překonáno Q054: OCCT ztrácí paměť samo, test nemá co ověřit"
tags:
  - otazka
created: 2026-10-13
updated: 2026-10-13
---
# Q053 Citlivost paměťového testu OCCT

**Oblast:** [[06-geometricke-jadro]] · **Rozhodnout do:** [[M07-kernel-occt]]

## Otázka

Akceptační kritérium [[M07-kernel-occt]] zní: opakované `makeBox` + `tessellate` + `release` nezvětšuje haldu WASM. Test z Ú4 měří `oc.wasmMemory.buffer.byteLength` po 500 kolech. Implementátor ale ověřil, že **test úniky nezachytí**: modul startuje se 100 MB paměti a `byteLength` roste, až když alokátor vyčerpá volné místo. S úmyslným únikem celého kvádru se sítí (~7 kB na kolo) paměť poprvé narostla až po 4033 kolech. Neuvolněný `Node(i)` nebo `release`, který nic nemaže, test nepoznal.

Build nevystavuje `mallinfo` ani `sbrk`, takže přesnou spotřebu haldy nezměříme ([[0013-replicad-opencascadejs|ADR 0013]]).

## Možnosti a návrh

| Varianta | Pro | Proti |
|---|---|---|
| A: víc kol (~5000) | jednoduché | 1,5–5 s v `check`, zachytí jen úniky v řádu kB na kolo |
| **B: před měřením zaplnit haldu** bloky přes `___libc_malloc`, dokud paměť nenaroste, poslední blok uvolnit; pak už malý únik paměť zvětší | citlivé (únik nad ~64 kB celkem, tedy ~130 B na kolo při 500 kolech), rychlé | interní symbol Emscriptenu; když zmizí, test hlasitě spadne (ne potichu projde) |
| C: počítat živé objekty OCCT v adaptéru (obal kolem konstrukcí) | přesné | zásah do návrhu adaptéru kvůli testu, všechny `new oc.X` přes obal |
| D: nechat hrubý test a spolehnout se na `using` a revizi | žádná práce | kritérium milníku by nebylo ověřené testem |

Návrh: **B**. Pomůcka `fillWasmHeap(oc)` bude jen v testu (s komentářem, proč a jak), po testu bloky uvolní. Kritérium M7 zůstane, test ho skutečně ověří. Ověřit, že s úmyslným únikem (neuvolněný `Node(i)`) test spadne.

## Rozhodnutí

2026-10-13: **Varianta B.** Pomůcka jen v testu `kernel-occt` zaplní volnou haldu bloky přes `___libc_malloc`, dokud `wasmMemory` nenaroste, poslední blok uvolní; po testu uvolní všechny. Test musí prokazatelně spadnout s úmyslným únikem. Propsáno do [[06-geometricke-jadro#Testy|spec 06]].

2026-10-13 (později): **Zrušeno.** Varianta B byla implementována, ale citlivý test padá i bez chyby adaptéru: paměť ztrácí samo OCCT (~11 kB na kvádr). Navíc alokátor buildu (mimalloc) roste po segmentech ~31 MB, takže „uvolnit poslední blok“ nechá velkou rezervu. Pokračuje [[Q054 Únik paměti v OCCT buildu|Q054]].
