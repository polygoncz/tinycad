---
type: concept
aliases:
  - DocumentSnapshot
code: "DocumentSnapshot"
module: "persistence"
summary: "Plný stav dokumentu k danému seq; zrychluje otevření."
related:
  - "[[Operační log]]"
tags:
  - pojem
created: 2026-10-12
updated: 2026-10-12
---
# Snapshot

Plně serializovaný [[Dokument|dokument]] k určitému `seq` [[Operační log|logu]]. Při otevření se načte poslední snapshot a přehrají se jen záznamy po něm. Ukládá se každých ~100 záznamů.

**V návrhu:** [[05-persistence]]
**Souvisí:** [[Operační log]]
