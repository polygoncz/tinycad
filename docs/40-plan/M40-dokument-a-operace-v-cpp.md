---
type: milestone
status: done
order: 40
aliases:
  - M40
  - M40 Dokument a operace v C++
modules:
  - server
specs:
  - "[[03-dokument]]"
  - "[[04-operace-a-historie]]"
depends_on:
  - "[[M39-kostra-serveru]]"
started: 2026-10-17
finished: 2026-10-17
tags:
  - milnik
created: 2026-10-17
updated: 2026-10-17
---
# M40 – Dokument a operace v C++

**Cíl:** Doménový model dokumentu, schémata vestavěných featur (datová půlka), operace, log, transakce a undo v C++, ověřené sdílenými případy z [[M38-zmrazeni-domeny|M38]].

> Upřesněno 2026-10-17 při plánování samostatného běhu ([[Rozhodnutí nativního jádra]], N9–N31). Stopa A souběžných stop po [[M39-kostra-serveru|M39]] ([[Roadmapa#Nativní jádro (M38–M47)]]).

**Specifikace:** [[03-dokument]], [[04-operace-a-historie]], [[13-testovani#Sdílené testovací případy]], [[0030-nativni-jadro-pres-grpc|ADR 0030]]

**Navazuje na:** [[M39-kostra-serveru]] a úkol 0 hlavního sezení (knihovna `tinycad_core`, podpora sdílených případů, viz [[Roadmapa#Nativní jádro (M38–M47)]])

**Zdroj pravdy o chování:** zmrazené `src/document`, `src/ops`, `src/features/*/schema.ts` a jejich testy v `test/unit/`. C++ zrcadlí strukturu a jména TS modulů.

## Úkoly

- [x] 1. Knihovna `document` (model, reference, dokument, JSON, načtení a migrace, schéma a validace)
- [x] 2. Schémata osmi vestavěných featur a jejich sdílené případy (souběžně se 3)
- [x] 3. Operace, handlery, `applyOperation`, upcast a přehrání (souběžně se 2)
- [x] 4. Log, dispečer, transakce, undo a property test přehrání

Úkol 1 jde první a sám. Úkoly 2 a 3 běží souběžně (dva subagenti `implementer` ve vlastních worktree), úkol 4 po sloučení 3. Převod `tinycad.v1.Operation` ↔ JSON operace se přesunul do [[M45-sezeni-pres-grpc|M45]] (N27 ⚠); schéma skici a jeho případy `validate-sketch-*` jsou v [[M44.1-builder-skici-na-serveru|M44.1]] (N22).

## Akceptační kritéria

- Sdílené případy `ops.upcast` (112), `ops.replay` (8), `ops.script` (17), `document.load` (33), `schema.visibleWhen` (30) a `schema.validate` bez `validate-sketch-*` (63) projdou v C++ (GoogleTest v Dockeru, `npm run check:server`).
- Property test: náhodné sekvence operací (vlastní generátor se semínkem, N28) → přehrání logu na výchozí dokument dá týž dokument (`sameStudio`), undo všeho vrátí výchozí stav.
- Veřejné hlavičky `tinycad/document/*.hpp` odpovídají zafixovanému kontraktu; změna jde přes hlavní sezení.
- Knihovny `tinycad_document`, `tinycad_ops` a `tinycad_features` nezávisí na OCCT, gRPC ani protobufu.

## Implementační plán

Jeden úkol = jedno spuštění subagenta `implementer` (Opus, TDD). Pro všechny úkoly:

- **OOP a KISS** (Pavel, N9): čitelné objektové C++ – třídy s jednou odpovědností a malým veřejným rozhraním (`Document`, `FeatureSchemaRegistry`, `OperationLog`, `OperationDispatcher`, `Transaction`, `UndoManager`, abstraktní `OpHandler` s potomkem pro každý typ operace), virtuální rozhraní pro porty, RAII. Žádné šablonové metaprogramování, žádné „chytré“ funkcionální řetězce, žádná akrobacie s `std::variant` a visitorem tam, kde se líp čte malá hierarchie tříd nebo `switch` nad `kind`. Nejjednodušší návrh, který projde sdílenými případy. Neměnnost dokumentu zůstává (hodnotové objekty, `shared_ptr<const T>`), ale přes API třídy.
- **Kontrakt:** zafixované hlavičky `server/src/document/include/tinycad/document/*.hpp` a `server/src/core/include/tinycad/core/*.hpp` (hlavní sezení, N9–N22). Implementátor je **nemění** (výjimka: jména parametrů a přidané `#include`); chybějící funkci nebo nejasnost vrací jako otázku. Vlastní hlavičky `tinycad/ops/*.hpp` a `tinycad/features/*.hpp` navrhuje sám podle TS a uvádí je v hlášení.
- **Build:** každá oblast `server/src/<oblast>/CMakeLists.txt` s knihovnou `tinycad_<oblast>` (`target_compile_features(... PUBLIC cxx_std_23)`, N10), testy `server/test/<oblast>/` s vlastním spustitelným `tinycad_<oblast>_tests`, spouštěče sdílených případů `server/test/shared-cases/<oblast>_cases_test.cpp` nad podporou z úkolu 0 (načtení obálky, porovnání s tolerancemi podle spec 13). Kořenový `server/CMakeLists.txt` stopa jen doplní o `add_subdirectory` (N25).
- **Testy:** unit testy se portují z odpovídajících `test/unit/<modul>/*.test.ts` (co dává smysl v C++; testy odběratelů událostí a izolace objektů odpadají, N21). Sdílené případy jsou akceptační cíl. Spouštěč dělá **totéž srovnání pořadí** jako TS spouštěč (`test/integration/shared-cases/<oblast>.test.ts`); pořadí, které doména neurčuje, se srovná před porovnáním.
- **Ověření:** cílené testy v Dockeru (`npm run check:server` nebo `docker build --target build` s filtrem `ctest -R`); celý `npm run check` při sloučení stopy (N2).
- **Chyby:** očekávané selhání = `core::Result` (`std::expected`), chyba programu = `TINYCAD_ASSERT` (N10). Texty chyb se netestují, jen kódy a cesty.

### 1. Knihovna `document`

- **Soubory:** `server/src/document/CMakeLists.txt`, `src/{model,refs,origin,document,json,serialize,schema,validate,ref_kinds,evaluate}.cpp` (zrcadlí `src/document/*.ts`; `references.ts` a `testing.ts` se neportují), testovací buildery `server/test/document/testing.hpp` (`aFeature()`, `aDocument()` jako `src/document/testing.ts`), `server/test/document/*_test.cpp`.
- **Kontrakt:** `model.hpp`, `refs.hpp`, `origin.hpp`, `document.hpp`, `schema.hpp`, `serialize.hpp`. Neměnnost podle N17: mutátor třídy `Document` vytvoří nový `PartStudioData` a nezměněné featury sdílí (stejný `FeaturePtr`); volání beze změny ponechá týž `StudioPtr`. Pravidla rollback baru a kanonický tvar metadat těles přesně jako `cad-document.ts`. `fromData` hlásí **všechny** problémy se stejnými cestami jako TS (`studio.features[3].id`, `studio.bodies['a/body'].color`). Čísla: `isWholeNumber` bere i `2.0` (spec 13), výstup přes `core::numberJson`.
- **Testy:** port `test/unit/document/{cad-document,document,json,model,origin,refs,ref-kinds,schema,validate,serialize,evaluate}.test.ts`; navíc: NaN a ±∞ v `params` odmítne `isJsonObject`; mutátor beze změny drží týž `StudioPtr`; `replaceFeature` sdílí ostatní `FeaturePtr`.
- **Hotovo když:** unit testy zelené v Dockeru; registr s testovacím schématem (verze 2 s `migrate`) migruje při `fromData` a hlásí novější verzi u `typeVersion`.

### 2. Schémata vestavěných featur (souběžně se 3)

- **Soubory:** `server/src/features/CMakeLists.txt` (knihovna `tinycad_features`, zatím jen schémata; buildery přidá [[M43-regenerace-v-cpp|M43]]), `server/src/features/{box,cylinder,boolean,extrude,revolve,fillet,chamfer,transform}/schema.{hpp,cpp}`, `server/src/features/include/tinycad/features/builtin.hpp` + `builtin.cpp` (`void registerBuiltInSchemas(document::FeatureSchemaRegistry&)` v pořadí `test/integration/shared-cases/support/plugins.ts` bez skici), `server/test/features/*_test.cpp`, spouštěče `server/test/shared-cases/schema_cases_test.cpp` (`schema.validate`, `schema.visibleWhen`) a `document_cases_test.cpp` (`document.load`).
- **Kontrakt:** každé schéma je třída `FeatureSchema` se stejným `type`, `version`, `label`, `icon`, parametry v pořadí TS, `defaults()` a `validate()` (generická kontrola + vlastní pravidla featury, např. boolean stejné těleso, extrude `add` bez cíle, fillet duplicitní hrana). TS predikáty `visibleWhen` se převedou na data `VisibleWhen` podle [[14-protokol#Schéma featur]]: extrude `targets` a revolve `targets` = `equals_none ["new"]` nad `operation`, extrude `distance` = `equals_none ["upToFace"]`, `upTo` = `equals_any ["upToFace"]`, `flip` = `equals_any ["blind"]` nad `endType`; revolve `flip` = `less_than 2π − 1e-9` nad `angle`; transform `pivotPoint` = `equals_any ["point"]` nad `pivot` (ověřit proti `schema.ts` každé featury). Transform verze 3 s `migrate` 1 → 2 → 3 jako `src/features/transform/schema.ts`.
- **Spouštěč `schema.validate`:** issues seřazené podle `param`, `code` a kanonického JSON `params` (klíče seřazené, číslo v nejkratším tvaru, celé číslo bez `.0`, jako `JSON.stringify`), řetězce po bajtech (id i klíče jsou ASCII); řazení nesmí záviset na stabilitě (spec 13). Případy `validate-sketch-*` spouštěč přeskočí s odkazem na M44.1 (seznam přeskočených je pevný, ne podle chyby).
- **Testy:** port `test/unit/features/<name>/<name>.test.ts` (část schématu); každý `VisibleWhen` featury proti TS predikátu na hodnotách z případů.
- **Hotovo když:** 63 + 30 + 33 sdílených případů zelených.

### 3. Operace, handlery, `applyOperation`, upcast a přehrání (souběžně se 2)

- **Soubory:** `server/src/ops/CMakeLists.txt` (knihovna `tinycad_ops`, závisí na `tinycad_document`), `server/src/ops/include/tinycad/ops/{operation,handler,apply,upcast,parse_entry,replay,log}.hpp`, `src/{operation,handler,apply,upcast,parse_entry,replay,log}.cpp`, `src/handlers/{feature,studio,body,document}.cpp`, `server/test/ops/*_test.cpp`, spouštěč `server/test/shared-cases/ops_cases_test.cpp` (`ops.upcast`, `ops.replay`).
- **Kontrakt:** operace je JSON objekt `{ type, v, … }` spec 04, v C++ `using Operation = core::Json` (KISS, N18; log na disku zůstává tento JSON, [[0005-operacni-log|ADR 0005]]). `OP_VERSION` jako `operation.ts`. Abstraktní třída `OpHandler` (`type`, `version`, `invert`, `apply`, volitelné `merge`, `upcast`, `validate`) s potomkem pro každý typ v `src/handlers/`, `OpHandlerRegistry` jako `FeatureSchemaRegistry`; `validate` vrací `OperationLoadError { path, message }`. `applyOperation` jediné místo, kudy operace jde do dokumentu: validace a verze, dávka atomicky (při selhání vrátí aplikované kroky), obnova rollback baru inverzí (Q029). `upcastOperation` a `parseLogEntry` se stejnými cestami chyb jako TS (`ops[1].feature.params`). Handler `feature.add`/`setParams` migruje data featury přes `migrateFeatureData`.
- **Testy:** port `test/unit/ops/{operation,handler,apply,upcast,parse-entry,replay,log}.test.ts`. Spouštěč potřebuje registr schémat z úkolu 2 (`builtin.hpp`); do jeho sloučení si implementátor vystačí s testovacími schématy v unit testech a spouštěč dokončí po natažení `main` se sloučeným úkolem 2.
- **Hotovo když:** 112 `ops.upcast` a 8 `ops.replay` zelených.

### 4. Log, dispečer, transakce, undo a property test

- **Soubory:** `server/src/ops/include/tinycad/ops/{dispatcher,transaction,undo}.hpp`, `src/{dispatcher,transaction,undo}.cpp`, `server/test/ops/{dispatcher,transaction,undo,replay_property}_test.cpp`, spouštěč `ops.script` v `ops_cases_test.cpp`.
- **Kontrakt:** třídy `OperationLog` (append-only, `entries(fromSeq)`, `lastSeq`), `OperationDispatcher` (`dispatch(op, meta)`, `begin(label)` → `Transaction&` nebo `std::unique_ptr<Transaction>`, rozhodne implementátor) (`apply`, `applyTransient`, `commit`, `abort`; slučování sousedních kroků při `apply` a při `commit`, přechodné kroky přeruší slučování), `UndoManager` (`canUndo`, `canRedo`, `undo`, `redo`, `stacks`), `rebuildUndoStacks(entries)`. Bez událostí (N21): dispečer po zápisu záznamu zavolá háček `onAppended(const LogEntry&)`, na který se napojí `UndoManager`; `canUndo` je nepravda při otevřené transakci. Reentrance a druhý `begin` jsou `TINYCAD_ASSERT`. Hodiny `now` jako závislost (determinismus spec 13: čas = pořadí kroku skriptu).
- **Property test** (N28): `std::mt19937` se semínkem, 200 sekvencí po 1–40 platných operacích (add, remove, setParams, rename, suppress, move, rollback, body.*, dávky, undo/redo, transakce s přechodnými kroky) nad dokumentem z `aDocument()`; vlastnosti z `test/unit/ops/replay.property.test.ts`. Při selhání vypíše semínko a nejkratší prefix, který selhává.
- **Testy:** port `test/unit/ops/{dispatcher,transaction,undo}.test.ts` bez testů výjimek odběratelů.
- **Hotovo když:** 17 `ops.script` zelených, property test zelený, všechny případy stopy A zelené v jednom běhu; revize `architecture-reviewer` na konci milníku.

## Co se naučíš

Neměnná data a event sourcing v C++: sdílení struktur přes `shared_ptr<const T>`, identita ukazatele místo identity objektu, `std::expected` místo `Result` a co z TS v C++ odpadne (události, výjimky odběratelů).

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Retrospektiva

_Návrh Clauda (samostatný běh, stopa A)._

- Jeden implementátor, čtyři úkoly po sobě, souběžně se stopami B a C; sloučení bez konfliktu.
- Sdílené případy stopy A zelené v C++: `ops.upcast` 112, `ops.replay` 8, `ops.script` 17, `document.load` 33, `schema.validate` 63 (8 skic patří M44.1), `schema.visibleWhen` 30. Celkem 568 testů serveru.
- Property test přehrání (vlastní generátor, 200 semínek) chytil úmyslně rozbitou obnovu rollback baru.
- Odchylka od TS: nesedící operace je očekávaná chyba (`Result` s cestou), ne výjimka – operace chodí po síti (N80).
