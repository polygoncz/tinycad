---
type: concept
aliases:
  - Tool
code: "Tool / ToolDescriptor"
module: "interaction"
summary: "Interaktivní režim ve viewportu; vyrábí operace, nemění dokument přímo."
related:
  - "[[Akce]]"
  - "[[Výběr]]"
  - "[[Transakce]]"
tags:
  - pojem
created: 2026-10-12
updated: 2026-10-12
---
# Nástroj

Interaktivní režim ve [[Viewport|viewportu]] (výběr, tvorba kvádru, skicování). Vždy je aktivní právě jeden; `Esc` vrací na výchozí výběrový nástroj. Nástroj nikdy nemění dokument přímo – vyrábí [[Operace|operace]] nebo otevírá dialog featury (`FeatureEditSession` nad [[Transakce|transakcí]]).

**V návrhu:** [[10-interakce]]
**Souvisí:** [[Akce]], [[Výběr]], [[Transakce]]
