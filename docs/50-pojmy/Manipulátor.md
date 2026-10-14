---
type: concept
aliases:
  - Manipulator
  - Gizmo
  - Úchyt
code: "ManipulatorDescriptor / Handle / ManipulatorController"
module: "interaction"
summary: "Úchyt ve viewportu, jehož tažením se interaktivně mění parametry otevřené featury."
related:
  - "[[Kotva manipulátoru]]"
  - "[[Plugin featury]]"
  - "[[Viewport]]"
  - "[[Nástroj]]"
tags:
  - pojem
created: 2026-10-14
updated: 2026-10-14
---
# Manipulátor

Úchyt ve [[Viewport|viewportu]] (šipka, kružnice), jehož tažením myší se mění [[Parametr featury|parametry]] featury, která má otevřený dialog. Každý úchyt pracuje s jedním skalárem. `value` hodnotu čte z params a `toParams(value)` z ní vyrobí změnu params, takže obecný controller nezná sémantiku featury. Úchyty deklaruje [[Plugin featury|plugin]] čistou funkcí z params a [[Kotva manipulátoru|kotev]]. Na rozdíl od [[Nástroj|nástroje]] manipulátor nevytváří nic nového, jen mění existující featuru přes `FeatureEditSession`.

**V návrhu:** [[10-interakce#Manipulátory (M18)]], [[0021-manipulatory-kotvy-z-regenerace|ADR 0021]]
**Souvisí:** [[Kotva manipulátoru]], [[Nástroj]], [[Transakce]]
