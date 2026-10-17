---
type: concept
aliases:
  - Idempotence
  - operation_id
code: "operation_id"
module: "server"
summary: "Požadavek s id od klienta, který při opakování vrátí výsledek prvního provedení a znovu se neprovede."
related:
  - "[[Operace]]"
  - "[[Sezení]]"
tags:
  - pojem
created: 2026-10-17
updated: 2026-10-17
---
# Idempotentní požadavek

Každý požadavek, který něco mění, nese `operation_id` vygenerované klientem. Když odpověď nedorazí, klient pošle týž požadavek se stejným id znovu a server vrátí výsledek prvního provedení, aniž by změnu provedl podruhé. Díky tomu je bezpečné opakovat po výpadku, kdy klient neví, jestli server požadavek dostal. U zapsaných záznamů [[Operační log|logu]] je `operation_id` uložené v SQLite, takže platí i po restartu serveru. Stejné id s jiným obsahem je chyba klienta (`OPERATION_ID_REUSED`).

**V návrhu:** [[14-protokol]], [[Q094 Nativní jádro na serveru přes gRPC|Q094]] (zásada 2)
**Souvisí:** [[Operace]], [[Sezení]]
