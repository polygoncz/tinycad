---
type: moc
status: active
aliases:
  - Samostatný běh M39–M47
  - Rozhodnutí série nativního jádra
tags:
  - plan
created: 2026-10-17
updated: 2026-10-17
---
# Rozhodnutí nativního jádra

Pavel 2026-10-17: „zkus naimplementovat všechny milníky. Pokud budeš potřebovat něco rozhodnout, tak to rozhodni. Nakonec mi z toho připravíš prezentaci.“ Milníky [[M39-kostra-serveru|M39]]–[[M47-uklid-a-dokonceni|M47]] proto běží bez průběžného schvalování, stejným postupem jako [[Rozhodnutí noční rychloakce]]. **Tady je průběžný seznam všeho, co jsem rozhodl sám.** Podrobnosti jsou v odkazované otázce, ADR nebo specifikaci, tady je jedna věta a proč.

Postup: plán a kontrakty ve vaultu → úkoly přes `implementer` (po M39 tři souběžné stopy podle [[Roadmapa#Nativní jádro (M38–M47)]]) → kontrola proti spec a sdíleným případům z [[M38-zmrazeni-domeny|M38]] → `npm run check` → commit po milníku do větve, slučování do `main` po milnících. Nic se nepushuje.

Značka **⚠ k revizi** = rozhodnutí, u kterého si nejsem jistý nebo které zužuje rozsah.

## Shrnutí pro revizi

- **Pavel 2026-10-17: návrh a architekturu serveru projdeme spolu po sérii** (třídy, hranice knihoven v `server/src/`, porty). Do té doby platí OOP a KISS (N12) a strukturální rozhodnutí jsou v seznamu níže.

_(doplňuje se průběžně)_

## Obecné

- **N1 – Docker Desktop spuštěný z běhu.** Neběžel; build serveru a Envoy podle [[0030-nativni-jadro-pres-grpc|ADR 0030]] Docker potřebují. Na hostitele se nic neinstaluje (CMake, vcpkg, buf běží v kontejneru nebo přes npm).

- **N2 – Testy po větších celcích** (Pavel během běhu: „pracuj efektivně, paralelně, testuj spíše větší celky“). Implementátoři pouští jen cílené testy; celý `npm run check` při sloučení milníku nebo stopy, e2e na konci větších celků.

- **N9 – OOP a KISS v C++** (Pavel během běhu: „Když vidím zdrojáky, možná by nebylo od věci snažit se programovat OOP a KISS.“). Kontrakty i implementace jako čitelné objektové C++: třídy s jednou odpovědností a malým rozhraním (`Document`, `FeatureSchemaRegistry`, `OperationDispatcher`, `Transaction`, `UndoManager`, `OcctKernel` za abstraktním `GeometryKernel`, `Sketch`, `PlanegcsSolver`), virtuální rozhraní pro porty, RAII; žádné šablonové metaprogramování, funkcionální řetězce ani `std::variant` s visitorem, kde se líp čte malá hierarchie nebo `switch`. Proč: Pavel zná C++/OCCT, Laravel a Kotlin, kód má číst a učit se z něj; nejjednodušší návrh, který projde sdílenými případy. Pravidlo je v Implementačním plánu M40, M42 a M44.

- **N10 – C++23 kvůli `std::expected`.** Každá knihovna oblasti má `target_compile_features(... PUBLIC cxx_std_23)`; očekávané selhání je `core::Result<T, E>` = `std::expected`, chyba programu `TINYCAD_ASSERT` (výjimka `AssertionError`) jako `assert` v TS. Proč: GCC 13 z Ubuntu 24.04 má `<expected>` jen v režimu C++23, `tl::expected` není ve vcpkg seznamu a vlastní `Result` by byl další kód; C++23 zvýší standard i pro cíle s `CMAKE_CXX_STANDARD 20`.

- **N11 ⚠ – Společná oblast `server/src/core` (`tinycad_core`) a úkol 0 hlavního sezení po sloučení M39.** Obsahuje `Vec2`, `Vec3`, `Mat4`, `Plane`, `Curve2`, `StrongId`, `Result` a JSON těchto typů; zrcadlí `src/core`. Hlavní sezení ji dokončí (implementace `json.hpp`, `curve2.hpp`, `CMakeLists.txt`) a zároveň převede `tinycad_geometry` z M39 na `core::Curve2` a vytáhne podporu sdílených případů do knihovny `tinycad_test_support`, než pustí stopy. Proč: všechny tři stopy potřebují stejné základní typy hned od startu; ⚠ protože M39 právě vzniká s vlastním typem křivky a sjednocení je práce navíc.

- **N12 – Jeden typ `Curve2` v `core` jako plochá struktura s `kind`.** `kernel::ProfileCurve` a `sketch::Curve2` jsou jen aliasy. Proč: TS má dva strukturálně stejné typy (ADR 0017), C++ strukturální typování nemá; plochá struktura se `switch` je jednodušší než `std::variant` (N9).

## M39 – Kostra serveru a GeometryService

- **N3 ⚠ – Aplikace volí adaptér `SketchGeometry` podle `VITE_CORE_URL`.** Se serverem jde 2D geometrie přes `GeometryService`, bez něj dál přes WASM. Proč: do [[M46-klient-nad-read-modelem|M46]] má aplikace běžet i bez Dockeru (Roadmapa: „až do té doby aplikace běží“) a stávající e2e nemají záviset na Compose. E2E přes server běží s `E2E_CORE=1`.
- **N4 – C++ kód z protobufu generuje CMake v kontejneru** (`protobuf_generate`, `grpc_cpp_plugin` z vcpkg), `buf generate` jen pro TS. Proč: verze `protoc` pro C++ musí sedět s knihovnou protobuf z vcpkg; přes buf by šlo o druhý zdroj pravdy.
- **N5 – Sdílený pojmenovaný svazek `tinycad-vcpkg-cache`** pro binární cache vcpkg napříč worktree. Proč: souběžné stopy by jinak každá překládaly OCCT a gRPC (desítky minut).
- **N6 ⚠ – Slučování požadavků `GeometryService` jen se stejným klíčem.** Jeden požadavek v letu na metodu zůstává, ale „poslední vyhrává“ jen mezi čekajícími voláními se stejným klíčem: `intersections` podle množiny id křivek, `offset` podle id řetězce a `closed`; `segment` a `fillet` se neslučují (fronta). Proč: implementátor M39 našel, že slučování podle spec 14 by nástrojům trim, split, zkosení a extend podstrčilo výsledek cizího volání (souběžné `segment`, `intersections` nástroje vedle bodů křížení celé skici). Spec 14 upravená.
- **N7 – `remote` smí záviset na `kernel`** (`createKernelError`, `KernelErrorCode`), aby chyby přes síť vypadaly jako z WASM jádra. Doplněno k [[Q106 Moduly klienta pro gRPC|Q106]] a do [[01-architektura]].
- **N8 – Vygenerovaný modul `src/protocol` má i vygenerovaný `index.ts`** (`scripts/gen-proto.mjs`), takže se do něj neimportuje hluboko; `gen:proto` běží jako pre-skript a snese souběžné spuštění v `run-p`.

## Kontrakty stop po M39 (M40, M42, M44)

Zafixované hlavičky: `server/src/core/include/tinycad/core/*.hpp`, `server/src/document/include/tinycad/document/*.hpp`, `server/src/kernel/include/tinycad/kernel/*.hpp`, `server/src/sketch/include/tinycad/sketch/*.hpp`, `server/src/solver-planegcs/include/tinycad/solver_planegcs/planegcs_solver.hpp`. Změna jde přes hlavní sezení (pravidlo série v [[Roadmapa#Nativní jádro (M38–M47)]]).

- **N13 – Jádro má synchronní API, `KernelResult<T>` a jednu instanci obsluhuje jeden volající.** Metody vrací `std::expected<T, KernelError>` a nikdy nevyhazují (výjimky OCCT převádí implementace na `OperationFailed`/`Internal`); instance není bezpečná pro vlákna a vrstva sezení (M45) volání serializuje. Proč: `Promise` v TS byl jen kvůli workeru; jeden volající odpovídá dnešnímu jednomu workeru a ušetří zámky v jádře.
- **N14 – `ShapeHandle` je `enum class` nad `uint64_t`, tabulka tvarů žije v `OcctKernel::Impl` (pimpl).** Handle se nikdy nepoužije znovu; typy OCCT nejsou ve veřejných hlavičkách a zničení jádra uvolní všechny tvary (RAII). Proč: stejný kontrakt jako TS (`unknown-handle` po uvolnění) a hranice, za kterou OCCT nepronikne do regenerace.
- **N15 – 2D metody portu (`curveIntersections`, `curveSegment`, `filletArc`, `offsetCurves`) nejsou v C++ `GeometryKernel`.** Jsou v `tinycad_geometry` z M39 za `GeometryService`. Proč: žádný builder featury je nevolá, volá je jen skicář přes síť; `makeFace` a `profileRegions` v jádře zůstávají (regenerace).
- **N16 – `ModelingKernel` je v hlavičce jádra, ne v regeneraci.** Proč: rozhraní v C++ jsou nominální, implementace ho musí dědit; v TS si ho mohl definovat spotřebitel (ADR 0011).
- **N17 – Neměnný dokument přes `shared_ptr<const …>` a třídu `Document`.** Featura je `FeaturePtr`, stav studia `StudioPtr`; mutátor vytvoří nový stav a nezměněné featury sdílí, volání beze změny drží týž ukazatel. Proč: identita ukazatele nahradí identitu objektu, na které stojí cache regenerace (M43) i test „beze změny“ v `applyOperation`; čtenář drží konzistentní snímek zadarmo.
- **N18 – Parametry featur i operace zůstávají `nlohmann::json`.** Typové jsou jen uvnitř pluginů. Proč: jejich tvar určuje schéma, ne C++ typy, stejně jako `google.protobuf.Struct` na drátě a JSON v logu (ADR 0005); nejjednodušší (N9).
- **N19 – Id jako `core::StrongId<Tag>`** (`FeatureId`, `BodyId`, `SketchEntityId`…) s explicitní konstrukcí. Proč: zrcadlí `Brand` z TS, záměna id je chyba překladu a místo, kde id vzniká, zůstává vidět.
- **N20 – `VisibleWhen` je v C++ data a `ParamSpec` plochá struktura s `kind`.** Predikáty TS se převedou na `equals_any`/`equals_none`/`less_than` podle Q105. Proč: stejná data jdou klientovi (`FeatureTypeDescriptor`) a vyhodnotí je jedna funkce na každé straně.
- **N21 ⚠ – C++ dokument a operace nemají události.** Dispečer po zápisu záznamu zavolá háček `onAppended`, na který se napojí `UndoManager`; logika výjimek odběratelů (odložené chyby, `AggregateError`) z TS odpadá, stejně jako její testy. Proč: na serveru žádní odběratelé nejsou, sezení (M45) volá regeneraci samo; ⚠ protože se tím vědomě neportuje část spec 04.
- **N22 – Schémata osmi vestavěných featur (datová půlka) patří do M40, schéma skici do M44.1.** Leží v `server/src/features/<name>/schema.*` (knihovna `tinycad_features`, buildery přidá M43); stopa A tak sahá i do `server/src/features/`, stopa B tam začne až v M43 po sloučení M40. Případy `validate-sketch-*` (8) ověří M44.1. Proč: sdílené případy `schema.*` a `document.load` (migrace transformace) potřebují schémata už v M40, validace skici potřebuje model skici ze stopy C.
- **N23 – Model skici jako malé hierarchie tříd a třída `Sketch`.** `SketchEntity` a `SketchConstraint` s `kind()` a `as<T>()`, sdílené jako `shared_ptr<const …>`; `Sketch::parse` je jediné důvěryhodné místo z JSON, odvozené křivky jsou metody `Sketch`; zpáteční cesta JSON zachová všechna pole TS. Proč: řešič vrací vstupní entity se všemi poli a `SketchView` posílá entity klientovi; OOP podle N9.
- **N24 – Adaptér řešiče je samostatná knihovna `server/src/solver-planegcs` a planegcs se vendoruje ze `Salusoft89/planegcs` v1.3.0.** Ne z hlavní větve FreeCADu. Proč: zrcadlí modul `solver-planegcs` z TS a stejné zdroje jako WASM 1.3.0 v klientovi dají stejné výsledky jako zaznamenané sdílené případy.
- **N25 – Rozložení buildu a testů.** Knihovna `tinycad_<oblast>` v `server/src/<oblast>/CMakeLists.txt` s veřejnými hlavičkami v `include/tinycad/<oblast>/`, unit testy `server/test/<oblast>/` (spustitelné `tinycad_<oblast>_tests`), spouštěče sdílených případů `server/test/shared-cases/<oblast>_cases_test.cpp` nad `tinycad_test_support`. Proč: zrcadlí `src/<modul>` a `test/unit/<modul>` z TS (ADR 0023) a stopy si v kořenovém `CMakeLists.txt` přidávají jen řádky `add_subdirectory`.
- **N26 ⚠ – Akceptace M42 je C++ kontraktová sada (port `src/kernel/testing.ts` a testů adaptéru), ne sdílené případy.** M38 sdílené případy samotného jádra nezapsal; chování jádra v sestavě ověří případy `regen` v M43. Proč: přepsat kontraktovou sadu do GoogleTest je přímé a stopa B nečeká na M40; ⚠ protože hrubý plán M42 počítal se sdílenými případy jádra.
- **N27 ⚠ – Převod `tinycad.v1.Operation` ↔ JSON operace se přesouvá z M40 do M45.** Proč: je to hranice služby; knihovny domény (`document`, `ops`, `features`) tak nezávisí na protobufu a stopa A nečeká na generovaný kód.
- **N28 – Property test přehrání s vlastním generátorem** (`std::mt19937` se semínkem, výpis semínka a nejkratšího selhávajícího prefixu). Proč: RapidCheck není ve vcpkg seznamu, který stopy nemění, a generátor platných operací je stejně specifický pro doménu.
- **N29 – `profileRegions` v C++ je port algoritmu `kernel-occt/regions.ts`, ne `BOPAlgo` ani `BRepAlgoAPI_Splitter`.** Proč: jména oblastí a `crossing` musí sedět se sdílenými případy `regen`; Splitter má zdokumentované odchylky (spec 06) a oblasti z křížících se křivek se nedělají (Q093).
- **N30 – Úkol 1 milníku s jednou knihovnou založí všechny zdrojové soubory s pahýly.** Následné souběžné úkoly mění jen své soubory a CMake se nemění. Proč: tři implementátoři nad jednou knihovnou bez konfliktů při slučování (M42, obdobně M40 přes oddělené knihovny).
- **N31 – Paměťový test jádra přes RSS procesu.** 200 kol modelování a uvolnění, růst po zahřátí nejvýš 20 MB a `liveHandleCount` 0; Q054 a Q055 se uzavřou jako specifické pro WASM build. Proč: nativní OCCT nemá omezenou haldu WASM, takže stačí hlídat únik, ne strop.

