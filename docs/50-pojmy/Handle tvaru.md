---
type: concept
aliases:
  - ShapeHandle
code: "ShapeHandle"
module: "kernel"
summary: "Neprůhledné číslo odkazující na TopoDS_Shape ve workeru jádra."
related:
  - "[[Geometrické jádro]]"
  - "[[Mark and sweep]]"
tags:
  - pojem
created: 2026-10-12
updated: 2026-10-12
---
# Handle tvaru

Neprůhledné číslo, které odkazuje na `TopoDS_Shape` žijící ve workeru [[Geometrické jádro|jádra]]. Tvary nikdy neopouštějí worker. Každá operace vrací nový handle; handle se musí uvolnit – řeší [[Mark and sweep]]. Nikdy se neukládá do dokumentu.

**V návrhu:** [[06-geometricke-jadro]]
**Souvisí:** [[Geometrické jádro]], [[Mark and sweep]]
