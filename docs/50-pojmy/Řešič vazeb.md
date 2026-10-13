---
type: concept
aliases:
  - ConstraintSolver
  - Constraint solver
  - Stupně volnosti
  - DoF
code: "ConstraintSolver"
module: "sketch"
summary: "Port, který z entit a vazeb skici spočítá polohy bodů, stupně volnosti a konfliktní vazby; adaptér planegcs ve workeru."
related:
  - "[[Skica]]"
  - "[[Port a adaptér]]"
tags:
  - pojem
created: 2026-10-14
updated: 2026-10-14
---
# Řešič vazeb

Numerický řešič soustavy rovnic, které vznikají z vazeb [[Skica|skici]] (vodorovnost, shoda bodů, kóta…). Vrátí nové polohy bodů, počet **stupňů volnosti** (DoF; 0 = skica je plně určená a kreslí se jinou barvou) a seznam konfliktních a redundantních vazeb. V tinycadu je to [[Port a adaptér|port]] `ConstraintSolver` z modulu `sketch`; adaptér `solver-planegcs` obaluje řešič GCS z FreeCADu (WASM) ve vlastním workeru ([[0016-planegcs-resic-vazeb|ADR 0016]]). Řešič volá jen editace skici, nikdy regenerace.

**V návrhu:** [[12-skicar#Řešič vazeb]]
**Souvisí:** [[Skica]], [[0016-planegcs-resic-vazeb]]
