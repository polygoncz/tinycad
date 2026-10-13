---
type: adr
status: accepted
number: 16
aliases:
  - ADR 0016
  - Planegcs jako řešič vazeb
date: 2026-10-14
related:
  - "[[12-skicar]]"
  - "[[Q020 Planegcs v samostatném workeru]]"
  - "[[0002-occt-wasm-ve-workeru]]"
  - "[[0011-programovani-proti-rozhranim]]"
  - "[[M12-skicar]]"
supersedes:
tags:
  - adr
created: 2026-10-14
updated: 2026-10-14
---
# 0016 – Řešič vazeb `@salusoft89/planegcs` ve vlastním workeru

- **Stav:** Přijato (`status: accepted`, noční rychloakce bez Pavla – [[Rozhodnutí noční rychloakce#M12 – Skicář|R31]])
- **Datum:** 2026-10-14
- **Souvisí:** [[12-skicar]], [[Q020 Planegcs v samostatném workeru|Q020]], [[0002-occt-wasm-ve-workeru|ADR 0002]], [[0011-programovani-proti-rozhranim|ADR 0011]], [[Řešič vazeb]]

## Kontext

[[Skica]] potřebuje 2D řešič geometrických vazeb (vodorovnost, shoda bodů, kóty…), který spočítá polohy bodů a počet stupňů volnosti. Psát vlastní numerický řešič (Newton/LM nad soustavou rovnic) je samostatný projekt. FreeCAD má osvědčený řešič GCS (C++, Eigen); balík `@salusoft89/planegcs` ho přeložil do WASM a obalil API v JS.

Spike na začátku M12 (Node, Vitest, `worker_threads`, modulový Web Worker ve Vite dev i build) ověřil:

- Init 3–6 ms v Node, ~20 ms v prohlížeči, WASM 473 KiB. Obdélník (8 neznámých) se vyřeší pod 1 ms, 50 obdélníků za ~6 ms, 100 obdélníků za ~34 ms.
- Primitiva a vazby jako JSON objekty s id (`point`, `line`, `circle`, `arc` + povinné `arc_rules`; `p2p_coincident`, `horizontal_l`, `vertical_l`, `parallel`, `perpendicular_ll`, `equal_length`, `equal_radius_*`, `tangent_*`, `p2p_distance`, `circle_radius`/`arc_radius`, `coordinate_x/y`). Tažení bodu = dočasné (`temporary`) vazby `coordinate_x/y`, které ustoupí ostatním a nesnižují počet stupňů volnosti.
- Stavy `Success`, `Converged` (redundantní vazby), `Failed`; seznamy `get_gcs_conflicting_constraints()` a `get_gcs_redundant_constraints()`.

Úskalí ze spiku:

1. Balík nemá `dist/planegcs_dist/planegcs.d.ts`, takže `init_planegcs_module` je `any`.
2. Debug režim tiskne do stdout (Playwright testy hlídají konzoli).
3. Wrapper neumí vazbu odebrat; postavit systém znovu je levné (< 1 ms).
4. Vazba mezi dvěma pevnými body (`fixed: true`) se do soustavy vůbec nedostane, takže se neprojeví ani jako konflikt.
5. Po `Failed` je `apply_solution` nesmysl.
6. Pevná paměť 21 MiB: ~900 neznámých → `RuntimeError: Aborted(OOM)`, instance modulu je pak mrtvá; nová instance funguje.
7. Licence balíku je `LGPL-2.0-or-later` (GCS z FreeCADu).

## Rozhodnutí

1. **Řešič vazeb je `@salusoft89/planegcs` 1.3.0** za portem `ConstraintSolver` z doménového modulu `sketch` ([[0017-modul-sketch-a-skicar|ADR 0017]], [[12-skicar#Řešič vazeb]]). Doména zná jen port; knihovnu zná jen adaptér `solver-planegcs` (prstenec 3).
2. **Adaptér běží ve vlastním workeru** přes `core/rpc`, stejně jako OCCT ([[0002-occt-wasm-ve-workeru|ADR 0002]], [[Q020 Planegcs v samostatném workeru|Q020]]): samostatné selhání (OOM řešiče neshodí jádro ani UI), UI se nezasekne u velké skici, a vzor (protokol odvozený z portu, `serveRpc` synchronně při startu, test strany workeru přes `MessageChannel` v Node) už v repu je. Port je proto asynchronní.
3. **Čistá funkce `solveSketch(module, input)` uvnitř adaptéru** schová snake_case API a měnitelný `sketch_index`: pokaždé nový `GcsSystem` (úskalí 3), `debug_mode = NoDebug` (2), `fix` jako dvojice vazeb `coordinate_x/y` místo `fixed: true` (4 – konflikt se pak nahlásí), konflikt nebo `Failed` → bez poloh (5), na konci `destroy_gcs_module()`.
4. **OOM:** `WebAssembly.RuntimeError` při řešení zahodí instanci modulu (další volání ji načte znovu) a volání vrátí stav `failed`; worker se neukončuje (úskalí 6). Pád celého workeru (`onerror`) → volání odmítne `'disconnected'` a adaptér při dalším `solve` spustí nový worker.
5. **Chybějící typy** (úskalí 1): jediná izolovaná výjimka v souboru `src/solver-planegcs/planegcs-module.ts` – vlastní rozhraní `PlanegcsModule { GcsSystem: GcsSystemConstructor }` a jedno okomentované přetypování `init_planegcs_module as InitPlanegcs`. Žádné `any` mimo tento soubor.
6. **Licence:** LGPL dovoluje použít knihovnu z aplikace s jinou licencí, když je knihovna vyměnitelná. WASM je samostatný soubor načítaný za běhu (`?url`), balík se neupravuje a jeho licence se uvede v README. tinycad je výukový a otevřený, takže podmínky LGPL bez potíží splní.

## Zvažované alternativy

- **Řešič v hlavním vlákně** – jednodušší (synchronní `solve`, tažení bez fronty), řešení je pod 1 ms. Ne: velká skica (~34 ms při 100 obdélnících) by zasekla UI a OOM by poškodil modul v hlavním vlákně; worker máme jako vzor hotový. Asynchronní port navíc nechává cestu otevřenou.
- **Řešič ve workeru jádra** – jeden worker méně. Ne: jádro zpracovává požadavky sériově, dlouhý boolean by blokoval tažení bodu, a pád jednoho by shodil druhé ([[Q011 Více workerů jádra|Q011]]).
- **Vlastní řešič v TypeScriptu** (Newton nad čtverci reziduí) – výukově zajímavé, ale robustnost (redundance, konflikty, degenerace) je práce na měsíce. Port nechává tuto cestu otevřenou.
- **`fixed: true` místo `coordinate_x/y`** – o dvě rovnice méně. Ne: vazba mezi pevnými body by se tiše ignorovala (úskalí 4).

## Důsledky

- (+) Doména je na knihovně nezávislá; `FakeSolver` z `sketch/testing.ts` stačí testům `interaction`.
- (+) Řešič se testuje v Node (Vitest) stejně jako OCCT; e2e ověří worker v prohlížeči.
- (−) Asynchronní tažení: `SketchSession` musí řešit souběh (jeden rozpracovaný požadavek a jeden čekající cíl, [[12-skicar#Režim skicáře (interaction)]]).
- (−) Další WASM (473 KiB) a další worker; další `optimizeDeps.exclude` ve Vite.
- (−) Systém se staví při každém řešení znovu; pro skici nad ~500 neznámých bude potřeba přírůstkové API nebo rozdělení skici na nezávislé části (zatím neřešíme).
