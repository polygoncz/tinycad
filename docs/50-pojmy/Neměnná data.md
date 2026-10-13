---
type: concept
aliases:
  - Immutability
  - Strukturální sdílení
code: ""
module: "document"
summary: "Změna = nový objekt; nezměněné části zůstávají tytéž objekty."
related:
  - "[[Regenerace]]"
  - "[[Featura]]"
tags:
  - pojem
created: 2026-10-12
updated: 2026-10-12
---
# Neměnná data

Doménová data se nikdy nemění na místě – změna vytvoří nový objekt a nezměněné části zůstanou **tytéž objekty** (strukturální sdílení). [[Regenerace]] díky tomu pozná změněnou featuru porovnáním identity (`!==`) a snapshot je kdykoli levný a konzistentní. Pozor: Vue `reactive()` by objekty obalilo proxy a identitu rozbilo.

**V návrhu:** [[03-dokument]], [[07-regenerace]], [[0006-nemenna-data]]
**Souvisí:** [[Regenerace]], [[Featura]]
