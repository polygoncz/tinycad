---
type: question
status: answered
area: "[[07-regenerace]]"
decide_by: "[[M06-regenerace]]"
proposal: "BuildContext.kernel je dekorátor, který zapíše každý vrácený handle do vlastněné množiny"
decision: "dekorátor jádra v BuildContext zaznamenává všechny vrácené handle"
tags:
  - otazka
created: 2026-10-13
updated: 2026-10-13
---
# Q041 Úklid mezivýsledků builderu

**Oblast:** [[07-regenerace]] · **Rozhodnout do:** [[M06-regenerace]]

## Otázka

[[Mark and sweep]] v [[Regenerace|regeneraci]] uvolňuje handle, které regen „kdy dostal od jádra“. [[Builder featury|Builder]] ale volá jádro přímo, takže regen vidí jen handle ve výstupním stavu. Pomocný tvar (nástroj odečtení v M13) nebo tvar vytvořený builderem, který pak skončil chybou, by unikl. Jak se regen dozví o všech [[Handle tvaru|handle]]?

## Možnosti a návrh

1. **Dekorátor jádra:** `BuildContext.kernel` obaluje skutečné jádro a každý handle z vráceného `ShapeResult` zapíše do vlastněné množiny.
   - \+ Builder se o úklid nestará, nejde na něj zapomenout. Funguje i pro výjimky a superseded generace.
   - − Obal se musí rozšiřovat s každou novou metodou vracející handle. Typ vynutí jen to, že obal má každou metodu portu; že nová metoda handle opravdu zapíše, hlídají testy obalu a testy úniků v regeneraci.
2. **Builder hlásí mezivýsledky** (`ctx.temporary(handle)`).
   - − Autor pluginu na to zapomene, únik se najde až testem.
3. **Builder uvolňuje mezivýsledky sám.**
   - − Porušuje pravidlo „builder nikdy neuvolňuje“, při výjimce uniká.

Návrh: **1**.

## Rozhodnutí

2026-10-13: Pavel souhlasí s návrhem (varianta 1). Propsáno do [[07-regenerace]].

> **Upřesnění (2026-10-13, revize architektury M6):** `BuildContext.kernel` má užší typ `ModelingKernel = PrimitiveOps & QueryOps` (definuje ho `regen` jako spotřebitel, [[0011-programovani-proti-rozhranim|ADR 0011]]). Builder tak `release` ani `liveHandleCount` vůbec nevidí – zákaz hlídá typ, ne odmítnutí za běhu. Nové skupiny operací (booleany v M13) se do `ModelingKernel` přidají spolu s jejich sledováním.
