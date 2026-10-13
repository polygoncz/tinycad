---
type: question
status: answered
area: "[[07-regenerace]]"
decide_by: "[[M06-regenerace]]"
proposal: "disconnected během buildu není chyba featury: run odmítne a regen zahodí cache i vlastněné handle; spec 06 opravit podle Q043"
decision: "disconnected není chyba featury: run odmítne, regen hned zahodí cache i vlastněné handle"
tags:
  - otazka
created: 2026-10-13
updated: 2026-10-13
---
# Q049 Pád jádra během regenerace

**Oblast:** [[07-regenerace]], [[06-geometricke-jadro]] · **Rozhodnout do:** [[M06-regenerace]]

## Otázka

Specifikace si odporují. [[06-geometricke-jadro#Chyby|Spec 06]] říká, že chyba bez kódu jádra (např. `RpcError` `'disconnected'`, [[Q037 Pád workeru a čekající RPC volání|Q037]]) je pro `regen` také chyba jádra – featura dostane `KERNEL` a regenerace nikdy nespadne celá. [[07-regenerace]] podle [[Q043 Výjimka builderu mimo jádro|Q043]] bere výjimku bez kódu jádra jako chybu programu a `run` odmítne. Co má [[Regenerace|regenerace]] udělat, když worker jádra spadne uprostřed buildu? Našel to implementátor v Ú5.

Dnešní kód (náhodou) dělá variantu 1 nepřímo: `run` odmítne, sweep zavolá `release`, ten také selže `'disconnected'` a teprve to vyprázdní cache a vlastněnou množinu.

## Možnosti a návrh

1. **`disconnected` není chyba featury.** `run` odmítne s `'disconnected'` a regen hned (bez volání `release`) zahodí cache i vlastněné handle – všechny handle zanikly s workerem. Zotavení (nový worker, nová regenerace od nuly) řeší `app` (M7/M10). Spec 06 se opraví podle Q043.
   - \+ Jedno pravidlo pro všechna místa (build i sweep). Featury nezčervenají kvůli něčemu, co s nimi nesouvisí.
   - − `run` odmítne místo „částečného“ výsledku.
2. **`disconnected` během buildu = `KERNEL` u featury**, regenerace pokračuje (podle spec 06).
   - − Všechny další featury selžou také, cache se naplní chybami, které po restartu workeru neplatí; handle v cache jsou mrtvé.
3. **Nechat jak je** (odmítnutí + úklid až přes selhání `release`).
   - − Funguje jen nepřímo, nepopsané chování.

Návrh: **1**.

## Rozhodnutí

2026-10-13: **varianta 1**. Propsáno do [[07-regenerace#Životnost handle: mark & sweep|spec 07]] a [[06-geometricke-jadro#Chyby|spec 06]].

> **Upřesnění (2026-10-13, revize architektury M6):** souběžný běh, který jádro nevolá (vše z cache), by po vyprázdnění mohl zapsat zpět cache s mrtvými handle. Proto po `'disconnected'` přejde Regenerator do stavu **mrtvý**: běžící i každý další `run` odmítne `RpcError` `'disconnected'`. `app` po pádu jádra vytvoří nové jádro i nový Regenerator.
