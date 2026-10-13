---
type: insight
status: seed
aliases:
  - Fasáda nad matematickou knihovnou
  - Facade over a library
topics:
  - návrhové vzory
  - TypeScript
sources:
  - https://refactoring.guru/design-patterns/facade
  - https://glmatrix.net/docs/
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Float32Array
tags:
  - poznatek
created: 2026-10-13
updated: 2026-10-13
---
# Fasáda nad knihovnou

**Shrnutí:** tenká fasáda nad cizí knihovnou neslouží jen k zúžení API. Dokáže změnit styl API (z mutujícího na neměnné), vynutit vlastnosti, které knihovna nechává na volajícím (přesnost, hlášení chyb), a je jediným místem, kde se řeší, když typy knihovny nesedí na skutečné chování.

## Podrobnosti

- **Změna stylu API.** gl-matrix zapisuje výsledek do parametru `out`, aby se nealokovalo (styl C++ `void cross(const vec3&, const vec3&, vec3& out)`). Fasáda volá knihovnu vždy s novým polem, takže navenek je API neměnné: vstup se nemění, výsledek je nový objekt. Celá logika se vejde do pomocné funkce `calc(op)`.
- **Přesnost určuje volající.** gl-matrix počítá v JS číslech (float64) a zapisuje do toho, co dostane. Její `create()` vrací `Float32Array`, takže `0.1 + 0.2` vyjde `0.30000001192092896`. Do obyčejného pole `[0, 0, 0]` vyjde `0.30000000000000004`. Fasáda tak vynutí float64 bez globálního nastavení knihovny.
- **Typy knihovny mohou lhát.** `mat4.fromRotation` vrací pro osu kratší než 1e-6 `null`, ale deklarace typů tvrdí, že vždy vrátí matici. Prozradilo to ESLint pravidlo `no-unnecessary-condition`, protože kontrola `!== null` podle typů „nemohla nastat“. Fasáda osu nejdřív normalizuje a nulovou osu odmítne výjimkou, takže `null` nastat nemůže.
- **Chování v hraničních případech se liší i mezi podobnými knihovnami.** Singulární inverze: gl-matrix vrací `null`, wgpu-matrix tiché `Infinity`/`NaN`, thi.ng `undefined`. Vyplatí se to ověřit během, ne čtením dokumentace.
- **Testy psané pro vlastní implementaci přežijí výměnu.** Když vznikne fasáda nad dřívějším vlastním kódem, staré testy ověří, že knihovna drží stejné konvence (column-major, pravotočivost, pořadí násobení).

## Jak to využívá tinycad

Fasáda `vec3`/`mat4` v `src/core/math/` podle [[0012-gl-matrix-za-fasadou|ADR 0012]]. Porovnání knihoven je v [[Q024 Knihovna pro vektorovou matematiku]], výsledné API ve specifikaci [[02-core]].

## Zdroje

- Refactoring Guru: návrhový vzor Facade.
- Dokumentace gl-matrix (parametr `out`, `setMatrixArrayType`).
- MDN: `Float32Array` (přesnost jednoduchých floatů).
