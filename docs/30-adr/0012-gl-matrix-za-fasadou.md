---
type: adr
status: accepted
number: 12
aliases:
  - ADR 0012
  - gl-matrix za fasádou v core
  - Knihovna pro vektorovou matematiku
date: 2026-10-13
related:
  - "[[02-core]]"
  - "[[01-architektura]]"
  - "[[0006-nemenna-data]]"
  - "[[0008-hranice-modulu]]"
  - "[[0009-platformove-nezavisla-domena]]"
  - "[[Q024 Knihovna pro vektorovou matematiku]]"
supersedes: 
tags:
  - adr
created: 2026-10-13
updated: 2026-10-13
---
# 0012 – gl-matrix za fasádou v `core`

- **Stav:** Přijato (`status: accepted`)
- **Datum:** 2026-10-13
- **Souvisí:** [[02-core]], [[01-architektura]], [[0006-nemenna-data]], [[0008-hranice-modulu]], [[Q024 Knihovna pro vektorovou matematiku|Q024]]

## Kontext

Spec [[02-core]] i akceptační kritérium [[M01-core|M1]] říkají, že `core` **neimportuje nic**, ani npm balíčky. V M1 proto vznikla vlastní minimální matematika (`vec3`, `mat4`).

Brzy ale přibudou inverze matic, transformace mezi rovinou skici a modelem, paprsky a průsečíky. Část z toho potřebuje `interaction` a doména, kde Three.js být nesmí ([[0009-platformove-nezavisla-domena|ADR 0009]]). Psát a ladit numeriku matic sami je zbytečné riziko, když existují prověřené knihovny.

Porovnání kandidátů (gl-matrix, wgpu-matrix, thi.ng, math.gl a další) je v [[Q024 Knihovna pro vektorovou matematiku|Q024]].

## Rozhodnutí

1. **Vektorová a maticová matematika stojí na knihovně gl-matrix 3.x.**
2. **Knihovna je schovaná za fasádou** `vec3` / `mat4` ve složce `src/core/math/`. Ostatní moduly znají jen naše typy `Vec3` a `Mat4` a naše funkce. Typy ani funkce gl-matrix se nikdy neobjeví ve veřejném API `core`.
3. **Výjimka z pravidla „`core` neimportuje nic“ je úzká:** gl-matrix smí importovat jen soubory v `src/core/math/`. Hlídá to dependency-cruiser (pravidlo `gl-matrix-only-in-core-math`). Jiné npm balíčky `core` dál nesmí.
4. **Fasáda zachovává naše konvence:**
   - neměnné výstupy: výstupní parametr `out` gl-matrix je vždy nové pole, vstupy se nemění ([[0006-nemenna-data|ADR 0006]]);
   - **float64**: `out` je obyčejné pole čísel, nikdy `create()` z gl-matrix, které vrací `Float32Array`;
   - chyby programátora hlásí výjimkou (nulový vektor, singulární matice), ne tichým `NaN` nebo `null`.
5. Roviny, souřadné systémy a paprsky (obdoby `gp_Pln`, `gp_Ax3`, `gp_Lin` z OCCT) žádná z knihoven nemá. Píšeme je sami nad fasádou, až budou potřeba.

## Zvažované alternativy

- **Vlastní matematika bez knihovny** (původní stav M1) – plná kontrola, ale vlastní numerika matic (inverze) je riziko bez užitku. Pavel chce knihovnu.
- **wgpu-matrix** – modernější API (volitelný `dst`, varianty float64), ale po vytřesení asi 5× větší (varianty vznikají továrnou) a singulární inverzi vrací jako tiché `NaN`.
- **@thi.ng/vectors + matrices** – bohaté a s `readonly` typy, ale 12 balíčků ekosystému a malá komunita.
- **Knihovna přímo, bez fasády** – méně kódu, ale typy knihovny by prosákly do celé domény a výměna knihovny by zasáhla všechny moduly. Mutovatelné API by šlo proti ADR 0006.
- **Nový modul `geom`, který smí knihovnu** – `core` by zůstal čistý, ale přibyl by modul, další řádek v tabulce [[01-architektura]] a závislost skoro všech modulů na něm. Úzká výjimka uvnitř `core` je jednodušší.

## Důsledky

- \+ Prověřená numerika (inverze, rotace, projekce) místo vlastní.
- \+ Typy a API domény se nemění, změna je jen uvnitř `src/core/math/`. Knihovnu jde vyměnit bez zásahu jinde.
- \+ Stávající testy `vec3`/`mat4` zůstávají a ověřují, že fasáda drží konvence (column-major, pravotočivost, pořadí násobení).
- − Porušené čisté pravidlo „`core` nic neimportuje“. Mírní to úzká výjimka hlídaná nástrojem.
- − Fasáda alokuje nové pole pro každý výsledek. Pro CAD data to stačí, pro horké smyčky při 60 fps (vykreslování) se použije Three.js v `render`.
- − gl-matrix 3 se už jen udržuje a verze 4 je v betě. Pro stabilní matematiku to nevadí, výměnu umožní fasáda.
