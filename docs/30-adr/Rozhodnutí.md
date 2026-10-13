---
type: moc
status: active
aliases:
  - ADR
  - Rozhodnuti
  - Architecture Decision Records
tags:
  - moc
created: 2026-10-12
updated: 2026-10-12
---
# Rozhodnutí (Architecture Decision Records)

Krátké záznamy o důležitých rozhodnutích: co jsme řešili, co jsme zvolili, proč a s jakými důsledky.

**Pravidla**
- ADR se nepřepisují. Když se rozhodnutí změní, vznikne nové ADR s vlastností `supersedes` a staré dostane `status: superseded`.
- Nové ADR se zakládá šablonou *ADR*. Číslo je další v řadě, soubor `NNNN-kratky-nazev.md`.
- Malá rozhodnutí patří do [[Konvence vaultu#Otázky|otázek]] (`60-otazky/`). ADR je jen pro to, co mění architekturu, knihovny, hranice modulů nebo formát dat.

![[adr.base#Všechna rozhodnutí]]
