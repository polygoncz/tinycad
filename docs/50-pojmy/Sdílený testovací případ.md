---
type: concept
aliases:
  - Sdílené testovací případy
  - Sdílené případy
  - Golden test
code: "test/shared-cases"
module: "test"
summary: "Jazykově nezávislý testovací případ v JSON (vstup, očekávaný výstup, tolerance), který musí projít TS doména i C++ jádro."
related:
  - "[[Port a adaptér]]"
  - "[[Determinismus operací]]"
tags:
  - pojem
created: 2026-10-17
updated: 2026-10-17
---
# Sdílený testovací případ

Soubor JSON v `test/shared-cases/<oblast>/`, který popisuje jedno chování domény jako data: druh případu (`kind`), vstup, očekávaný výstup (výsledek nebo kód chyby) a tolerance. Každý jazyk má pro každý druh jeden spouštěč, takže stejné soubory ověřují TS doménu i C++ jádro `tinycad-core`. Očekávané výstupy se nepíšou ručně, zaznamená je TS doména (`npm run cases:record`, [[Q107 Výstupy sdílených případů|Q107]]); jinde se tomu říká *golden test*. Od kontraktové sady portu se liší tím, že tvrzení nejsou kód, ale data, a nezávisí na jazyce implementace.

**V návrhu:** [[13-testovani#Sdílené testovací případy]], [[M38-zmrazeni-domeny|M38]], [[0030-nativni-jadro-pres-grpc|ADR 0030]]
**Souvisí:** [[Port a adaptér]], [[Determinismus operací]]
