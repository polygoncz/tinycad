---
type: concept
aliases:
  - RegenState
code: "RegenState"
module: "regen"
summary: "Neměnný snímek artefaktů (těles, od M12 skic a rovin) po dané featuře."
related:
  - "[[Regenerace]]"
  - "[[Těleso]]"
  - "[[Artefakt]]"
tags:
  - pojem
created: 2026-10-12
updated: 2026-10-14
---
# Stav regenerace

Neměnný snímek toho, co existuje po dané featuře: jedna mapa [[Artefakt|artefaktů]] podle `kind`, v M10.1 jen [[Těleso|těles]] ([[0015-artefakty-a-identita-telesa|ADR 0015]]). Stavy sdílejí nezměněná tělesa (a tedy handle) – proto se handle uvolňují přes [[Mark and sweep]].

**V návrhu:** [[07-regenerace]]
**Souvisí:** [[Regenerace]], [[Těleso]], [[Artefakt]]
