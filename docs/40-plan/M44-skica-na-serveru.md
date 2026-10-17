---
type: milestone
status: todo
order: 44
aliases:
  - M44
  - M44 Skica na serveru
  - M44 Model skici a řešič v C++
modules:
  - server
  - sketch
specs:
  - "[[12-skicar]]"
  - "[[14-protokol]]"
depends_on:
  - "[[M39-kostra-serveru]]"
started:
finished:
tags:
  - milnik
created: 2026-10-17
updated: 2026-10-17
---
# M44 – Model skici a řešič v C++

**Cíl:** Model skici (třída `Sketch`) a nativní planegcs (třída `PlanegcsSolver`) v C++ jako samostatné knihovny, ověřené sdílenými případy řešiče a odvozených entit z [[M38-zmrazeni-domeny|M38]]. Builder skici a opětovné řešení v handleru `setParams` jsou v [[M44.1-builder-skici-na-serveru|M44.1]].

> Rozděleno 2026-10-17 (Pavel): model skici a řešič na regeneraci nezávisí, proto běží jako souběžná stopa C hned po [[M39-kostra-serveru|M39]] ([[Roadmapa#Nativní jádro (M38–M47)]]). Původně jeden milník „Skica na serveru“ po M43.
>
> Upřesněno 2026-10-17 při plánování samostatného běhu ([[Rozhodnutí nativního jádra]], N9–N31).

**Specifikace:** [[12-skicar]] (*Data*, *Kontrola dat*, *Řešič vazeb*, *Křivky pro oblasti a odvozená id*, *Spliny (M29)*, *Zrcadlení a pole (M36)*, *Text ve skice (M37)*), [[13-testovani#Sdílené testovací případy]] (`sketch.solve`, `sketch.derived`, [[Q109 Řešič skici ve sdílených případech|Q109]]), [[0030-nativni-jadro-pres-grpc|ADR 0030]]

**Navazuje na:** [[M39-kostra-serveru]] (build, vcpkg s Eigen a Boost) a úkol 0 hlavního sezení (`tinycad_core`, podpora testů)

**Zdroj pravdy o chování:** `src/sketch/{model,parse,points,patterns,text,geometry,solver}.ts`, `src/solver-planegcs/solve.ts` a obal `@salusoft89/planegcs` 1.3.0 (`sketch/gcs_wrapper.ts`), testy `test/unit/sketch/{model,parse,points,patterns,text,geometry}.test.ts` a `test/unit/solver-planegcs/{solve,solve-offset,shapes}.test.ts`. Editační pomůcky skicáře (trim, snap, konstrukce, kóty) zůstávají v klientovi a neportují se.

## Úkoly

- [ ] 1. Model skici, kontrola dat a JSON (třída `Sketch`)
- [ ] 2. planegcs ze zdrojů a kouřový test (souběžně s 1)
- [ ] 3. Odvozené entity a sdílené případy `sketch.derived`
- [ ] 4. Adaptér `PlanegcsSolver` a sdílené případy `sketch.solve` (souběžně s 3)

Úkoly 1 a 2 běží souběžně (2 sahá jen do `server/third_party/planegcs/`), po sloučení obou běží souběžně 3 a 4.

**Kontrakt pro ostatní stopy:** hlavičky `server/src/sketch/include/tinycad/sketch/{model,sketch,solver}.hpp` a `server/src/solver-planegcs/include/tinycad/solver_planegcs/planegcs_solver.hpp` jsou zafixované (N23, N24). Na nich staví [[M44.1-builder-skici-na-serveru|M44.1]].

## Akceptační kritéria

- Sdílené případy `sketch.derived` (37) a `sketch.solve` (75, včetně kontroly pevného bodu při DOF > 0 podle [[13-testovani#Sdílené testovací případy]]) jsou zelené v C++ i v TS.
- Knihovny `tinycad_sketch` a `tinycad_solver_planegcs` nezávisí na regeneraci, dokumentu ani OCCT (`tinycad_sketch` jen na `tinycad_core`; adaptér navíc na vendorovaném planegcs, Eigen a Boost).
- planegcs je vendorovaný ze stejné verze jako WASM v klientovi, s licencí (LGPL-2.1) a záznamem původu.

## Implementační plán

Jeden úkol = jedno spuštění subagenta `implementer` (Opus, TDD). Pro všechny úkoly:

- **OOP a KISS** (Pavel, N9): čitelné objektové C++ – `Sketch` (rozparsovaná neměnná skica s vyhledáním podle id a odvozenými křivkami), malé hierarchie `SketchEntity` a `SketchConstraint` se `switch` nad `kind()` a `as<T>()`, `ConstraintSolver` jako virtuální port a `PlanegcsSolver` jako jeho implementace, RAII kolem `GCS::System`. Žádné šablonové metaprogramování, žádné funkcionální řetězce, žádný `std::variant` s visitorem. Nejjednodušší kód, který projde sdílenými případy.
- **Kontrakt:** zafixované hlavičky výše (N23, N24). Implementátor je **nemění** (výjimka: jména parametrů konstruktorů, `#include`); chybějící funkci vrací jako otázku.
- **Build a testy:** knihovny v `server/src/sketch/CMakeLists.txt` (`tinycad_sketch`) a `server/src/solver-planegcs/CMakeLists.txt` (`tinycad_solver_planegcs`), vendorovaný planegcs jako statická knihovna `planegcs` v `server/third_party/planegcs/CMakeLists.txt`; testy `server/test/sketch/`, `server/test/solver-planegcs/`, spouštěč `server/test/shared-cases/sketch_cases_test.cpp` (N25). Kořenový `CMakeLists.txt` jen `add_subdirectory`.
- **Spouštěče** dělají totéž srovnání jako `test/integration/shared-cases/sketch.test.ts` (řazení `conflicting`/`redundant`, kontrola pevného bodu bez `drag`, porovnání struktury entit při DOF > 0, taženého bodu s tolerancí `length`).

### 1. Model skici, kontrola dat a JSON

- **Soubory:** `server/src/sketch/CMakeLists.txt`, `src/model.cpp` (jména druhů, `isCurve`, `isPattern`, `isLineCarrier`, `isPatternSource`, `isDimension`, `step()`), `src/parse.cpp` (`Sketch::parse` – port `src/sketch/parse.ts` včetně pořadí hlášení a tolerancí poloměru oblouku 1e-6, `textParamsValid`, `patternParamsValid`), `src/json.cpp` (`entityJson`, `constraintJson`, `Sketch::entitiesJson/constraintsJson` – přesně tvar TS, volitelná pole jen když jsou nastavená, `char` u obrysu písmene), `src/sketch.cpp` (konstruktor, `findEntity`, `findPoint`); testovací buildery `server/test/sketch/testing.hpp` (obdélník, kružnice, text… jako `src/sketch/testing.ts`, jen co testy potřebují).
- **Testy:** port `test/unit/sketch/{model,parse,points}.test.ts`; zpáteční cesta JSON → `Sketch` → JSON beze změny pro vstupy všech 112 sdílených případů `sketch.*` (žádné pole se neztratí, `placement`, `reverseA`, `construction`, `direction2`); text s UTF-8 (počet kódových bodů, řídicí znaky).
- **Hotovo když:** testy zelené.

### 2. planegcs ze zdrojů a kouřový test (souběžně s 1)

- **Soubory:** `server/third_party/planegcs/` – zdroje z repozitáře `Salusoft89/planegcs` na značce `v1.3.0` (složka s C++ planegcs z FreeCADu a jeho obal `GcsSystem`, bez Embind vazeb a TS), `LICENSE`, `README.md` (původ: URL, značka, commit, datum, co se vynechalo), `CMakeLists.txt` (statická knihovna `planegcs`, Eigen3 a Boost z vcpkg, varování pro cizí kód vypnutá jen pro tento cíl); `server/test/solver-planegcs/planegcs_smoke_test.cpp`.
- **Kontrakt:** stejná verze jako `@salusoft89/planegcs` 1.3.0 v `package.json` (N24), aby nativní výsledky seděly se zaznamenanými z WASM. Zdroje se nemění; nutná oprava kvůli GCC 13 / C++23 se zapíše do `README.md` jako patch.
- **Testy:** kouřový test přímo přes API planegcs: dva body, vazba vzdálenosti a pevný bod → `Success`, DOF 0; konfliktní vazby → konflikt v `getConflicting`.
- **Hotovo když:** knihovna se přeloží v Dockeru a kouřový test je zelený.

### 3. Odvozené entity a `sketch.derived`

- **Soubory:** `server/src/sketch/src/{patterns,text,geometry}.cpp` (`Sketch::patternCopies`, `textCurves`, `regionCurves`, `curve2`, `patternOfCopy`, `derivedOwner` – port `patterns.ts`, `text.ts`, `geometry.ts` včetně odvozených id a pořadí), spouštěč `sketch.derived` v `sketch_cases_test.cpp`.
- **Testy:** port `test/unit/sketch/{patterns,text,geometry}.test.ts` (části o odvozených entitách a `regionCurves`).
- **Hotovo když:** 37 případů `sketch.derived` zelených.

### 4. Adaptér `PlanegcsSolver` a `sketch.solve` (souběžně s 3)

- **Soubory:** `server/src/solver-planegcs/CMakeLists.txt`, `src/planegcs_solver.cpp` (`solve`: nový systém pro každé řešení, druhé řešení pro bod na splinu za koncem, DOF z prvního řešení), `src/primitives.{hpp,cpp}` (převod entit a vazeb na primitiva planegcs – port `toPrimitives`, `entityPrimitives`, `constraintPrimitives`, `offsetPrimitives`, `tangentPrimitive`, `anglePrimitive` … ze `solve.ts` a z `gcs_wrapper.ts` obalu 1.3.0, který v TS dělá převod primitiv na volání `GcsSystem`), `src/read_back.cpp` (vyřešené souřadnice zpět do nových entit se stejnými poli, `backToIds` pro konfliktní a nadbytečné vazby, vynechání dočasných vazeb tažení `__drag`).
- **Kontrakt:** výsledek přesně podle `SolveResult` (`Ok` jen s entitami, `Failed` bez DOF, konflikt může mít záporné DOF, vazba může být v `conflicting` i `redundant`). Parametry řešiče (algoritmus, tolerance, počet iterací) jako výchozí v obalu 1.3.0, který používá TS.
- **Testy:** port `test/unit/solver-planegcs/{solve,solve-offset,shapes}.test.ts` (bez testů workeru a WASM pastí).
- **Hotovo když:** 75 případů `sketch.solve` zelených, celá sada stopy C zelená v jednom běhu, revize `architecture-reviewer` na konci milníku.

## Co se naučíš

Dva modely téže domény ve dvou jazycích a jak je udržet ve shodě; vendorování knihovny tak, aby výsledky seděly bit po bitu s WASM buildem.

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Retrospektiva

_(vyplnit po dokončení; obecné poznatky přesunout do `70-poznatky/`)_
