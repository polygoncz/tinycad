---
type: adr
status: accepted
number: 24
aliases:
  - ADR 0024
  - Modul sketcher
date: 2026-10-14
related:
  - "[[01-architektura]]"
  - "[[12-skicar]]"
  - "[[10-interakce]]"
  - "[[0008-hranice-modulu]]"
  - "[[0017-modul-sketch-a-skicar]]"
  - "[[M20-zpevneni-struktury]]"
supersedes:
tags:
  - adr
created: 2026-10-14
updated: 2026-10-14
---
# 0024 – Modul sketcher

- **Stav:** Přijato (`status: accepted`, Pavel 2026-10-14)
- **Datum:** 2026-10-14
- **Souvisí:** [[01-architektura#Tři prstence]], [[12-skicar]], [[0008-hranice-modulu|ADR 0008]], [[M20-zpevneni-struktury|M20]]

## Kontext

Prezentační logika skicáře (`sketch-editor`, `sketch-session`, `sketch-actions`, `sketch-tools*`, `sketch-drawing`, `sketch-dimensions`) má přes 2 000 řádků a leží v modulu `interaction`. Podle grafu importů ji uvnitř `interaction` nikdo jiný neimportuje, jen `index.ts`. Skicář přitom poroste nejrychleji (undo, další vazby, nástroje) a směr závislostí uvnitř modulu dnes nic nehlídá ([[Revize kódu 2026-10-14]], A4).

## Rozhodnutí

- Nový modul `src/sketcher` v prstenci 2 (prezentační logika, bez platformy).
- `sketcher` smí záviset na `interaction` (nástroje, `FeatureEditor`, `ViewportPort`, klávesy), `interaction` na `sketcher` nesmí. Směr hlídá dependency-cruiser.
- Jména parametrů pluginu skici bere `sketcher` z modulu `sketch` (A5), ne z řetězců.
- `app` skládá `sketcher` stejně jako ostatní moduly, `ui` z něj smí jen typy (jako z `interaction`).
- `render` se nedělí. Je to soudržný adaptér s jediným spotřebitelem.

## Zvažované alternativy

- **Podsložka `interaction/sketcher/`:** levnější, ale směr závislostí by hlídala jen revize.
- **Skicář jako součást pluginu `features/sketch`:** plugin by potřeboval prezentační logiku a prstenec 2 v prstenci 1, což [[0009-platformove-nezavisla-domena|ADR 0009]] i [[0017-modul-sketch-a-skicar|ADR 0017]] vylučují.

## Důsledky

- (+) `interaction` se zmenší asi o čtvrtinu a nemůže omylem záviset na skicáři.
- (+) Skicář jde testovat a vyvíjet jako celek s úzkým rozhraním.
- (−) Nový řádek v tabulce modulů ve spec [[01-architektura]] a v `.dependency-cruiser.cjs`. Obě tabulky musí zůstat shodné.
- (−) To, co skicář z `interaction` potřebuje, musí být ve veřejném API `interaction` (`index.ts`). API se tím rozšíří.
- (−) Kresby rovin, os a skic artefaktů (`planeDrawing`, `axisDrawing`, `artifactDrawing`) leží ve `sketcher`, i když je používá i režim modelu (`app/viewport-mirror`, `app/regen-pipeline`). `app` tak kvůli kreslení modelu závisí na skicáři. Přijatelné, protože jde o geometrii skic a `app` smí vše; kdyby kresby potřeboval jiný modul prstence 2, přesunou se k `SketchPort` do `interaction` (revize M20).
