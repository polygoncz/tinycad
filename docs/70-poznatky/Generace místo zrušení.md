---
type: insight
status: seed
aliases:
  - Generation counter
  - Latest wins
topics:
  - souběh
  - asynchronní programování
sources:
  - https://developer.mozilla.org/en-US/docs/Web/API/AbortController
  - https://jakearchibald.com/2015/tasks-microtasks-queues-and-schedules/
tags:
  - poznatek
created: 2026-10-13
updated: 2026-10-13
---
# Generace místo zrušení

**Shrnutí:** Když novější asynchronní běh nahrazuje starší, stačí čítač generací a kontrola po každém `await` – starý běh se nezastaví, jen zahodí výsledek.

## Podrobnosti

- Každé spuštění zvýší `generation` a zapamatuje si `current`. Po každém `await` se zkontroluje `current === generation`; když ne, běh skončí jako „nahrazený“.
- Kontrola má smysl **jen hned za `await`**: v JS běží kód mezi dvěma `await` bez přerušení, jinde novější běh začít nemohl.
- Sdílený stav (cache) zapisuje jen aktuální generace, takže starý běh nemůže přepsat novější výsledek.
- Proti `AbortController`: nic se neruší uprostřed volání, takže není třeba, aby volaný kód (worker, jádro) rušení podporoval. Cena: práce starého běhu doběhne zbytečně a jeho zdroje se musí uklidit jinde (sweep vítězné generace).
- Stejný vzor řeší „race“ u vyhledávání při psaní (zobrazit jen odpověď na poslední dotaz).

## Jak to využívá tinycad

`Regenerator.run` v [[07-regenerace#Souběh (generace)|regeneraci]] vrací `'superseded'`; handle nahrazeného běhu uklidí [[Mark and sweep]] další dokončené generace.

## Zdroje

- https://developer.mozilla.org/en-US/docs/Web/API/AbortController
- https://jakearchibald.com/2015/tasks-microtasks-queues-and-schedules/
