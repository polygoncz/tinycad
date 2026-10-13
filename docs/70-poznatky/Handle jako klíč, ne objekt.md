---
type: insight
status: seed
aliases:
  - Opaque handle
  - Identita odděleně od dat
topics:
  - architektura
  - geometrické jádro
  - web workery
sources:
  - https://dev.opencascade.org/doc/overview/html/occt_user_guides__ocaf.html
  - https://en.wikipedia.org/wiki/Entity_component_system
  - https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm
tags:
  - poznatek
created: 2026-10-13
updated: 2026-10-13
---
# Handle jako klíč, ne objekt

**Shrnutí:** Když data žijí za hranicí (worker, WASM, server), je lepší přes hranici posílat neprůhledné číslo jako klíč do tabulky vlastníka než stavět na druhé straně objekty-zástupce s metodami.

## Podrobnosti

- **Identita je levná a přenositelná, data zůstávají u vlastníka.** Ve workeru `HandleTable<handle, ShapeEntry>`, ven jde jen číslo a hodnoty (síť, bounding box).
- **Proxy objekt s metodami** (`shape.mesh()`) na straně klienta by nemělo vlastní data. Jen by přeposílalo volání a svádělo k míchání odpovědností. Navíc ho garbage collector uklidí, aniž by se uvolnila paměť ve workeru, takže explicitní `release` je stejně potřeba.
- **Dva obaly, dvě odpovědnosti:**
  - adaptér obaluje „co knihovna spočítala a jak to najít“ (tvar, mapy podtvarů, cache);
  - doména obaluje „co to znamená“ (stabilní ID napříč přepočty, kdo to vytvořil, jména).

  Handle se při každém přepočtu mění, doménové ID ne.
- **Nikdy znovu použitý handle** (rostoucí čítač) převádí souběhy (render tesseluje už uvolněný tvar) na detekovatelnou chybu `unknown-handle` místo tiché záměny tvarů. Jedinečnost platí jen v rámci instance, takže výměna instance musí zahodit všechny cache klíčované handle.
- **Stejný vzor jinde:** OCAF v OCCT (`TDF_Label` a atributy), ECS v herních enginech (entita = číslo, data v komponentách), file deskriptory v OS, `WebGLTexture`.

## Jak to využívá tinycad

[[Handle tvaru]], [[06-geometricke-jadro#Datové struktury na obou stranách]] (`ShapeEntry` ve workeru, `Body` v [[07-regenerace|regen]]), mark & sweep v regeneraci. Souvisí s [[0002-occt-wasm-ve-workeru|ADR 0002]].

## Zdroje

- OCCT: OCAF User's Guide (labels a atributy).
- Wikipedia: Entity component system.
- MDN: Structured clone algorithm.
