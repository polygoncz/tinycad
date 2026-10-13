---
type: concept
aliases:
  - rollbackIndex
code: "rollbackIndex"
module: "document"
summary: "Pozice, za kterou se featury nepřehrávají; nové featury se vkládají na ni."
related:
  - "[[Part Studio]]"
  - "[[Regenerace]]"
tags:
  - pojem
created: 2026-10-12
updated: 2026-10-12
---
# Rollback bar

Pozice v seznamu featur, za kterou se při [[Regenerace|regeneraci]] nic nepřehrává. Nové featury se vkládají na ni. Posun dozadu nic nepočítá, posun dopředu přepočítá jen nově zahrnuté featury. Mění se operací `studio.setRollback`.

**V návrhu:** [[03-dokument]], [[07-regenerace]], [[10-interakce]]
**Souvisí:** [[Part Studio]], [[Regenerace]]
