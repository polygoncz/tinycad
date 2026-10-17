---
type: concept
aliases:
  - Session
  - Sezení jádra
code: "session_id"
module: "server"
summary: "Jeden klient (karta) pracující s jedním dokumentem otevřeným v jádru; nezávisí na spojení."
related:
  - "[[Transakce]]"
  - "[[Read model]]"
  - "[[Idempotentní požadavek]]"
tags:
  - pojem
created: 2026-10-17
updated: 2026-10-17
---
# Sezení

Jeden klient, typicky jedna karta prohlížeče, který pracuje s jedním [[Dokument|dokumentem]] otevřeným v nativním jádru. Dokument je v paměti jádra jednou (běhový dokument), každá karta nad ním má vlastní `session_id`. Sezení nepatří spojení: výpadek sítě ho nezavře, skončí `CloseSession` nebo timeoutem nečinnosti. Nejvýš jedno sezení dokumentu drží zámek pro zápis a smí ho měnit, ostatní jen čtou. V sezení žije otevřená [[Transakce|transakce]] a undo.

**V návrhu:** [[14-protokol]], [[Q094 Nativní jádro na serveru přes gRPC|Q094]], [[Q102 Sezení pro více karet|Q102]]
**Souvisí:** [[Read model]], [[Idempotentní požadavek]]
