---
type: insight
status: seed
aliases:
  - Revize architektury proti rozhodnutím
topics:
  - architektura
  - revize kódu
  - proces
sources:
  - https://adr.github.io/
  - https://martinfowler.com/articles/is-quality-worth-cost.html
tags:
  - poznatek
created: 2026-10-13
updated: 2026-10-13
---
# Revize proti ADR, nejen proti spec

**Shrnutí:** Specifikace může omylem odporovat architektonickému rozhodnutí; implementace, která spec splní přesně, chybu jen zabetonuje, takže revize musí kód porovnat i s ADR, ne jen se specifikací.

## Podrobnosti

- Spec je odvozená z ADR, ale píše se později a po kouscích. Věta „`app` zaregistruje vestavěné akce“ vypadala nevinně, a přitom přesunula prezentační logiku (kdy je Smazat povolené) do kompozičního kořene proti [[0010-prezentacni-model|ADR 0010]].
- Implementátor, který má zákaz rozhodovat návrh, takovou chybu nenajde: spec splní doslova. To je správně – chyba je o úroveň výš.
- **Příznaky** chyby, které revize hledá: stejné pravidlo na víc místech (zámek „jen pro čtení nebo otevřený dialog“ třikrát), komponenta s podmínkami místo vazeb, natvrdo znaná id z jiné vrstvy, dědičnost přes hranici modulu.
- **Oprava jde shora:** nejdřív ADR → spec, pak kód. Jinak se rozpor vrátí s další změnou.
- Revize se vyplatí i u kódu, který prochází všemi testy a linterem: kontroluje to, co nástroje neumí – kam která logika patří.

## Jak to využívá tinycad

Subagent `architecture-reviewer` na konci každého milníku ([[Nástroje Claude Code]]); v [[M10-ui]] 9 nálezů, z toho hlavní proti ADR 0010, opravené vlnou F.

## Zdroje

- Architecture Decision Records (adr.github.io).
- Martin Fowler: Is High Quality Software Worth the Cost?
