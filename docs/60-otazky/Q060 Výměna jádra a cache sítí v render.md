---
type: question
status: answered
area: "[[09-vykreslovani]]"
decide_by: "[[M08-vykreslovani]]"
proposal: "BodyLayer.reset(meshes), volá ho app; napojení v M10"
decision: "BodyLayer.reset(meshes) zahodí cache a scénu; volá app, napojení v M10"
tags:
  - otazka
created: 2026-10-13
updated: 2026-10-13
---
# Q060 Výměna jádra a cache sítí v render

**Oblast:** [[09-vykreslovani]] · **Rozhodnout do:** [[M08-vykreslovani]]

## Otázka

Spec 09 říká, že výměna instance jádra (restart workeru, [[Q037 Pád workeru a čekající RPC volání|Q037]], [[Q055 Pád WASM jádra|Q055]]) zahodí `MeshCache`, protože [[Handle tvaru|handle]] jsou jedinečné jen v rámci instance. Jak se o výměně `render` dozví?

## Možnosti a návrh

1. **`BodyLayer.reset(meshes: MeshOps)`**: zahodí cache i zobrazená tělesa, rozběhlé `sync` zneplatní a dál používá nové `MeshOps`. Volá ho `app` ([[Kompoziční kořen|kompoziční kořen]]), který o restartu ví. Celé napojení až v [[M10-ui|M10]].
   - \+ `render` neví nic o workerech. + V M08 se dá otestovat samostatně.
2. **`render` poslouchá událost jádra.**
   - − `MeshOps` by musel nést životní cyklus, který do rozhraní pro tessellaci nepatří.
3. **Nový `Viewport` po restartu.**
   - − Ztratí se kamera a stav, zbytečně drahé.

Návrh: **1**.

## Rozhodnutí

2026-10-13 (Pavel): **možnost 1.** Propsáno do [[09-vykreslovani#Synchronizace s regenerací]].
