---
type: adr
status: accepted
number: 17
aliases:
  - ADR 0017
  - Modul sketch a skicář
date: 2026-10-14
related:
  - "[[12-skicar]]"
  - "[[01-architektura]]"
  - "[[0008-hranice-modulu]]"
  - "[[0015-artefakty-a-identita-telesa]]"
  - "[[0016-planegcs-resic-vazeb]]"
  - "[[M12-skicar]]"
supersedes:
tags:
  - adr
created: 2026-10-14
updated: 2026-10-14
---
# 0017 – Doménový modul `sketch`, skicář v `interaction` a kresba skici z dat

- **Stav:** Přijato (`status: accepted`, noční rychloakce bez Pavla – [[Rozhodnutí noční rychloakce#M12 – Skicář|R32–R35]])
- **Datum:** 2026-10-14
- **Souvisí:** [[12-skicar]], [[01-architektura]], [[0008-hranice-modulu|ADR 0008]], [[0015-artefakty-a-identita-telesa|ADR 0015]], [[0016-planegcs-resic-vazeb|ADR 0016]], [[Revize architektury 2026-10-13]] (nálezy 1, 6, 9)

## Kontext

[[Skica]] je featura jako každá jiná (schéma + builder, [[0004-data-oddelene-od-chovani|ADR 0004]]), ale její editace je **režim aplikace**: vlastní lišta nástrojů, kamera kolmo na rovinu, picking entit skici, řešič vazeb, stupně volnosti v panelu, tlačítko „Hotovo“. Hrubý návrh spec 12 dával vše do pluginu `features/sketch` a port řešiče tamtéž. Jenže:

- Prezentační logika patří do `interaction` ([[0010-prezentacni-model|ADR 0010]]) a `ui` smí znát jen `app`, `interaction` a `document`. Režim skicáře z pluginu by `ui` neviděla jinak než přes typy pluginu v `AppSession` – `app` by se vázal na konkrétní plugin.
- `interaction` nesmí importovat `features/*`, takže by neznal datový model skici ani port řešiče.
- Builder skici, editor skici, render i stav regenerace potřebují stejné typy (entity, vazby, rovina).

Druhá otázka je, jak skicu vykreslit. Revize navrhla křivky jako handle v jádře a `MeshOps.tessellateCurves`. Během tažení bodu se ale skica mění desítkykrát za sekundu a každé kolo přes jádro (stavba hran v OCCT, tessellace, přenos) by tažení zpomalilo; picking entit skici by navíc musel mapovat indexy hran OCCT zpět na id entit.

## Rozhodnutí

1. **Nový modul `sketch` v prstenci 1** (závisí jen na `core`): datový model skici (`SketchEntity`, `SketchConstraint`, id), kontrola dat, výpočet oblastí (planární graf), čisté pomůcky editace (`constraintFor`, `removeItems`, `measure`) a **port `ConstraintSolver`**. Je to doménová geometrie skici, ne plugin – stejně jako `document` není featura.
2. **Featura skici zůstává pluginem** `features/sketch` (schéma, builder, slovník), který `sketch` používá. Nástroje a režim skicáře jsou **vestavěné v `interaction`** (`SketchEditor`, `SketchSession`, `createSketchTools`, `createSketchActions`), stejně jako je vestavěný `FeatureEditor`. Vazba na plugin je jen konstanta `SKETCH_FEATURE_TYPE = 'sketch'` z modulu `sketch`.
3. **Kresba skici z dat, ne z jádra.** `interaction` převede entity na platformově nezávislou kresbu `SketchDrawing` (rovina + úsečky, oblouky a body ve 2D se stylem) a předá ji portu `ViewportPort.sketches`; `render` ji tesseluje a pickuje sám (`PickResult` druhu `sketchEntity` s id entity). Stejným kanálem `app` kreslí skici z poslední regenerace a zapnuté počáteční roviny.
4. **Profil jako handle v jádře** (nález 9) zůstává: builder skici postaví pro každou oblast plochu `SketchOps.makeFace` a artefakt skici nese `regions: ReadonlyMap<jméno, ShapeHandle>` pro Extrude (M13). Jména oblastí jsou v TypeScriptu. Drátěné křivky v jádře (`makeSketchCurves`) a `tessellateCurves` nevznikají, dokud je nepotřebuje sweep.
5. Tabulka modulů ([[01-architektura#Povolené závislosti]]) dostane `sketch` (`core`) a `solver-planegcs` (`core`, `sketch`, npm `@salusoft89/planegcs`); `sketch` smí importovat `regen`, `interaction`, `features/*` a `app`.

## Zvažované alternativy

- **Port řešiče a model skici v `features/sketch`** (původní spec 12) – ne: režim skicáře by nemohl být v `interaction` a `ui` by ho neviděla bez vazby `app` na plugin.
- **Datový model skici v `document`** – `document` je obecný recept bez znalosti konkrétních featur; skica by tam byla první výjimka.
- **Křivky skici jako handle a tessellace v jádře** (revize, nález 9) – jednotné s tělesy a připravené na sweep, ale pomalé při tažení a picking by potřeboval převod indexů hran na id entit. Plochy oblastí v jádře přesto vznikají (bod 4), takže M13 má profil jako handle.
- **Kreslit skicu přes `OverlayPort`** – overlay nemá id entit ani picking; dostal by druhou roli.

## Důsledky

- (+) `ui` zná režim skicáře jen přes `AppSession.sketches` (typy z `interaction`); plugin skici je malý a nový druh featury dál nevyžaduje změnu UI.
- (+) Tažení bodu jde řešič → `setParams` → kresba bez jádra; regenerace (plochy oblastí) běží na pozadí a plánovač ji slučuje.
- (+) Datový model, oblasti i port se testují v Node bez OCCT a bez řešiče.
- (−) `interaction` a `regen` znají jeden konkrétní druh featury (typ a data skici). Je to vědomá výjimka: skica je v CAD kontextem pro jiné featury, ne jen další featura (Onshape i Fusion ji tak mají).
- (−) Dvě reprezentace geometrie skici (data pro kresbu, plochy v jádře pro profil); musí dávat stejný tvar – hlídá test oblastí proti OCCT (obsah plochy).

## Dodatek 2026-10-14: skicář ve vlastním modulu

Umístění prezentační logiky skicáře v `interaction` nahrazuje [[0024-modul-sketcher|ADR 0024]]: skicář je modul `sketcher` v prstenci 2, závislý na `interaction`. Zbytek tohoto ADR (doménový modul `sketch`, kresba skici z dat) platí dál.
