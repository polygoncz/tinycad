---
type: concept
aliases:
  - Topological naming problem
  - TopoName
  - TopoRef
  - Topologické jméno
  - Topologická reference
code: "TopoName / TopoRef / NameTable"
module: "regen"
summary: "Stabilní jména ploch a hran, která přežijí regeneraci."
related:
  - "[[Těleso]]"
  - "[[Geometrické jádro]]"
  - "[[Výběr]]"
tags:
  - pojem
created: 2026-10-12
updated: 2026-10-12
---
# Topologické pojmenování

Řešení *topological naming problem*: po regeneraci vzniknou nové tvary s jinými indexy, takže reference na plochu či hranu musí být **jméno**, ne index. Plochy pojmenovává featura, která je vytvořila (`box1/face:top`), hrany se jmenují podle sousedních ploch, jména se přenášejí přes operace podle historie OCCT (`Generated`, `Modified`, `IsDeleted`). Nevyřešená reference = featura zčervená, nikdy tichý přeskok.

**V návrhu:** [[08-topologicke-pojmenovani]], [[0007-vlastni-topologicke-pojmenovani]]
**Souvisí:** [[Těleso]], [[Geometrické jádro]], [[Výběr]]
