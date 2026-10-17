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

- **Revize architektury serveru po M44:** návrh struktury knihoven a odložené body jsou v N110.
- **Pavel 2026-10-17: návrh a architekturu serveru projdeme spolu po sérii** (třídy, hranice knihoven v `server/src/`, porty). Do té doby platí OOP a KISS (N12) a strukturální rozhodnutí jsou v seznamu níže.

- **Plány M41, M43, M44.1 (2026-10-17), k revizi:** N35 (STORAGE → znovunačtení místo inverze), N37 (gRPC `DocumentService` do M45), N38 (migrace z IndexedDB jen existujícím exportem a `tinycad-import`), N47 (řešení skici před dispečerem, ne v handleru).

- **Plány M45 a M46 (2026-10-17), k revizi:** N56 (tři doplňky `.proto`), N63 (optimistické zrcadlo dokumentu v klientovi – v klientovi zůstanou TS handlery operací i po M47), N65 (lokální skica při `SKETCH_NOT_SOLVED` jen do konce transakce), N67 (vlastní pravidla validace featur se v dialogu u pole neukážou), N70 (spadlá karta drží zámek až 10 min), N71 (tlačítko přenosu z IndexedDB místo jen `tinycad-import`).

- **Plán M47 (2026-10-17), k revizi:** N120 (planegcs WASM v klientovi zůstává), N121 (paměťový dispečer, log a undo zůstanou jako testovací dvojník v `ops/testing.ts`), N124 (TS běžce sdílených případů jen `ops` a `sketch`, záznam nových případů jádra ručně), N126 (přenos z IndexedDB zmizí s `persistence`).

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
- **N5 – Sdílená binární cache vcpkg** jako BuildKit cache mount `id=tinycad-vcpkg-cache` (ne pojmenovaný svazek – build Dockeru svazek připojit nemůže), sdílená všemi worktree na jednom démonu. Proč: souběžné stopy by jinak každá překládaly OCCT a gRPC (první build ~28 min, další ~20 s).
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

## Plány M41, M43 a M44.1 (navazující milníky stop A a B)

Zafixované hlavičky navíc: `server/src/storage/include/tinycad/storage/{store,persistent_document,document_service}.hpp`, `server/src/regen/include/tinycad/regen/*.hpp`, `server/src/features/include/tinycad/features/{builders,sketch_solve}.hpp`. Plány v [[M41-persistence-sqlite|M41]], [[M43-regenerace-v-cpp|M43]] a [[M44.1-builder-skici-na-serveru|M44.1]].

### M41 – Persistence v SQLite

- **N32 – Soubor `<id>.tinycad.sqlite` na dokument, katalog = adresář.** Tabulky `meta`, `operations` (`seq`, `operation_id` UNIQUE, otisk, JSON záznamu) a `snapshots`; WAL a `synchronous=FULL`; JSON záznamů a snapshotů stejný jako v TS. Žádná katalogová databáze: seznam projde soubory. Id dokumentu jde do jména souboru, proto jen `[A-Za-z0-9_-]{1,64}`. Proč: soubor zůstane jediným zdrojem pravdy (jméno, `updatedAt`), pro jednoho uživatele je průchod desítek souborů zanedbatelný; whitelist brání cestě `../`.
- **N33 – Port rozdělený na `DocumentCatalog` a `DocumentFile`, bez paměťového storu.** Otevřený dokument drží jedno spojení SQLite; záznamy jdou portem jako JSON, takže úložiště nezávisí na `ops`. Testy běží nad skutečnými soubory v dočasném adresáři, selhání zápisu simuluje dekorátor. Proč: OOP (N9) a výkon (spojení na sezení místo otevírání podle id); `MemoryDocumentStore` byl v TS referenční implementace kvůli IndexedDB ve workeru, na serveru by to byla druhá implementace navíc.
- **N34 – Přísné `seq == lastSeq + 1` bez přepisu, idempotence přes `operation_id`.** Pravidlo „záznam se `seq ≤ lastSeq` se přepíše“ ze spec 05 odpadá; duplicitní `operation_id` je `DuplicateOperation`. Proč: přepis sloužil opakovanému zápisu z fronty prohlížeče po ztracené odpovědi; na serveru se zápis a odpověď neztratí odděleně a opakování požadavku řeší `operation_id` se stejným otiskem (spec 14).
- **N35 ⚠ – Po selhání zápisu (`STORAGE`) se dokument v paměti znovu načte ze souboru, místo aby se aplikovala inverze.** Selže-li i načtení, dokument je rozbitý a každá změna vrací `STORAGE`. Proč: log v paměti je append-only a vracet poslední záznam by porušilo jeho invariant; načtení ze souboru dá vždy stav shodný s diskem jedním obecným mechanismem. ⚠ protože spec 14 mluví o inverzi a otevřená transakce se tím zahodí.
- **N36 – `PersistentDocument` v `tinycad_storage` (M41) jako jádro běhového dokumentu.** Dokument, log, dispečer a undo z M40 nad `DocumentFile`; trvalé metody `dispatch`, `commit`, `undo`, `redo` s `OperationKey` zapíšou nejvýš jeden záznam před návratem, kroky transakce zůstávají v paměti; snapshot po každém 100. záznamu ve stejném volání, jeho selhání není chyba změny. Proč: akceptace M41 („kill a znovuotevření dají týž dokument i undo“, „jeden záznam pro stejné `operation_id`“) potřebuje spojení operací a úložiště už tady; M45 přidá sezení, zámek, regeneraci a read model.
- **N37 ⚠ – gRPC adaptér `DocumentService` patří do M45, M41 dodá aplikační třídu `storage::DocumentService`.** Proč: převod chyb na `google.rpc.Status` s `ErrorDetail` je úkol M45 a `RenameDocument` otevřeného dokumentu musí jít přes jeho sezení (jinak dva zapisovatelé jednoho `seq`); stejný vzor jako N27. ⚠ protože se tím posouvá rozsah.
- **N38 ⚠ – Migrace z IndexedDB zúžená na existující export a serverový nástroj `tinycad-import`.** V prohlížeči žádné hromadné tlačítko: dokumenty se exportují dnešním exportem s historií (M15) a `tinycad-import <soubory | adresář>` je naimportuje (nová id, jméno ze souboru, klíč `import:<sha256>`, opakované spuštění nezdvojí). Proč: jednorázová věc pro jednoho uživatele s pár dokumenty; tlačítko v UI by M47 stejně mazal. ⚠ protože hrubý plán počítal s exportem všech dokumentů z aplikace – pokud jich Pavel má hodně, přidá se v M46 skript nebo tlačítko.
- **N39 – Idempotence `CreateDocument` a `ImportDocument` přes metadata nového souboru.** Klíč požadavku (`operation_id` a otisk) se uloží do tabulky `meta` vytvořeného dokumentu a `findCreated` ho najde průchodem katalogu; soubor vzniká přes dočasné jméno a přejmenování. Proč: bez katalogové databáze (N32) je to jediné trvalé místo; atomické přejmenování zajistí, že klíč a dokument vzniknou zároveň.

### M43 – Regenerace v C++

- **N40 – Regenerace je synchronní, bez generací `superseded`, událostí a ztraceného jádra.** `Regenerator::run` vrací `RegenResult`, volitelný `RegenObserver::featureDone` slouží M45 pro `regen_progress`; builder vrací `core::Result<BuildOutput, FeatureError>` a chybu jádra předá `kernelFailure` (status `KERNEL`), výjimka z builderu je chyba programu (sweep a dál, Q043). Proč: jádro je synchronní (N13) a sezení volání serializuje, takže souběh generací a Q049 (pád workeru) na serveru nenastanou; chyby jako hodnoty odpovídají N10.
- **N41 – `RegenState` jako uspořádaný seznam `shared_ptr<const Artifact>` s malou hierarchií artefaktů.** `Body`, `SketchArtifact`, `PlaneArtifact`, `AxisArtifact` s `kind()` a `as<T>()`; pořadí vložení jako `Map` v TS, hledání lineárně. Proč: pořadí těles je kontrakt (nové na konec, změněné na místě) a stav má desítky položek; OOP podle N9 a N23.
- **N42 – `SketchArtifact` nezávisí na `tinycad_sketch`.** Nese rovinu, vyřešené entity a kopie polí jako JSON (pro `SketchView`), úsečky s body (pro osu rotace), plochy oblastí a obrysy. Proč: regenerace (M43) tak nečeká na model skici ze stopy C a `resolveAxis` je jednoduché hledání v seznamu; plní ho builder skici v M44.1.
- **N43 – `content_version` = `<prefix>.<handle>`, prefix `<ms startu procesu>-<čítač instancí Regeneratoru>`.** Proč: handle se v jedné instanci jádra nikdy neopakuje (N14) a každý nový tvar tělesa je nový handle, takže verze se mění právě s tvarem bez další evidence; prefix na instanci odliší dokumenty otevřené zároveň i restart serveru (Q100). Přestavěné těleso se stejnou geometrií dostane novou verzi, stejně jako dnešní identita `ShapeHandle` v `SceneSync`. Formát upřesní hlavní sezení ve spec 14 (dnes „`<epocha procesu>.<n>`“).
- **N44 – Buildery jako druhá knihovna `tinycad_feature_builders` ve stejných složkách `server/src/features/<name>/`.** `tinycad_features` (schémata, M40) tak nezávisí na regeneraci ani jádru. Proč: úložiště (M41) a popisy typů featur (M45) potřebují jen schémata a nemají linkovat OCCT.
- **N45 – Žádný C++ `FakeKernel`: testy regenerace běží nad `OcctKernel` s dekorátorem `CountingKernel`.** Počítání volání a vložené selhání (`failNext`) dělá dekorátor v testovací podpoře. Proč: nativní OCCT je v testech rychlé a M42 falešné jádro nemá; port `FakeKernel` by byl kód navíc, který se musí shodovat se skutečným jádrem.
- **N46 – Sdílené případy `regen`: 24 bez skici v M43, 15 se skicou v M44.1.** Spouštěč M43 přeskočí pevný seznam (seznam v M43). Extrude a Revolve ověří v M43 unit testy nad `aSketchArtifact`. Proč: všechny případy vysunutí a rotace staví na skice, jejíž builder potřebuje model skici z M44.

### M44.1 – Builder skici na serveru

- **N47 ⚠ – Opětovné řešení skici proběhne před dispečerem (`SketchOperationSolver`), ne v handleru `feature.setParams`.** Sezení (M45) pošle každou `Dispatch`/`Apply` operaci přes `SketchOperationSolver`, který u `setParams` a `feature.add` skici (i v dávce) nahradí `entities` řešením nativního planegcs, nebo vrátí `SKETCH_NOT_SOLVED`; do logu jde vyřešená operace. Proč: přehrání logu, undo i načtení pak řešič nepotřebují a zůstávají deterministické (handlery jsou čisté funkce); `ops` nezávisí na řešiči. ⚠ protože Q103 a hrubý plán M44.1 mluví o řešení „v handleru“.
- **N48 – Klíč `sketch.notSolved` patří do `src/ui/i18n/{cs,en}.ts` vedle `sketch.solverFailed`.** Proč: hlášky skicáře jsou tam, ne v `messages` pluginu skici; je to UI, na které se pravidlo zmrazení domény nevztahuje.

### Sloučení M39

- **N49 ⚠ – `check:server` není součástí `npm run check`**, je samostatný a nový `npm run check:full` pouští obojí. Odchylka od [[0030-nativni-jadro-pres-grpc|ADR 0030]] bod 8. Proč: `check` by pak vyžadoval běžící Docker i pro práci jen na klientovi; při slučování milníků se pouští `check:full`.
- **N50 – Triplet `arm64-linux-release`** (jen release build závislostí, poloviční čas) a staticky slinkovaná binárka v obrazu 206 MB.
- **N51 – 2D geometrie má vlastní `ErrorCode`** (`InvalidInput`, `OperationFailed`, `Internal`) a výsledné typy (`CurveHit`, `FilletArc`, `OffsetCurve`) v `tinycad/geometry/geometry.hpp`, aby nezávisela na knihovně jádra.
- **N52 – Envoy přijme cestu s předponou `/api` i bez ní** (Vite proxy předponu odstraňuje).

## Plány M45 a M46 (sezení přes gRPC a klient)

Zafixované hlavičky navíc: `server/src/session/include/tinycad/session/*.hpp`. TS kontrakty M46 jsou v [[M46-klient-nad-read-modelem#TS kontrakty (zafixuje úkol 1)]]. Plány v [[M45-sezeni-pres-grpc|M45]] a [[M46-klient-nad-read-modelem|M46]]; spec 14 upravená ve stejném kroku.

### M45 – Sezení přes gRPC

- **N53 – Jedna knihovna `tinycad_session` s doménou sezení i gRPC adaptéry; read model rovnou do zpráv `tinycad.v1`.** `SessionServiceImpl` a `DocumentServiceImpl` jsou v ní vedle `RuntimeDocument`, `SessionManager` a `ReadModelBuilder`. Proč: read model je kontrakt, C++ zrcadlo zpráv by byl druhý zdroj pravdy a převod navíc (KISS); oblast „sezení“ je služba, stejně jako `tinycad_service` pro `GeometryService`.
- **N54 – Vlákna: synchronní gRPC server, zámek manageru → zámek běhového dokumentu → zámek bufferu událostí.** Jedno `OcctKernel`, `Regenerator` a `PlanegcsSolver` na běhový dokument; každá metoda `RuntimeDocument` drží jeho mutex celou dobu, změny nikdy neběží pod zámkem manageru; `WatchSession` blokuje své vlákno v `EventRing::waitAfter`. Proč: jádro smí mít jednoho volajícího (N13) a dokumenty jsou na sobě nezávislé; asynchronní gRPC API by pro jednoho uživatele bylo jen složitější.
- **N55 – Generace read modelu = čítač změn běhového dokumentu, ne počet `Regenerator::run`.** Regenerace běží při každém read modelu s `input_of` toho požadavku, cache podle identity ji zlevní. Proč: `input_of` je per požadavek a sezení, kdežto generace má růst jen se změnou dokumentu (události `changed`, zahození staršího read modelu v klientovi).
- **N56 ⚠ – Tři doplňky kontraktu:** `OpenSessionRequest.resume_session_id` (reload karty pokračuje v témže sezení se zámkem), `BodyView.face_planes` (roviny rovinných ploch: klient bez jádra otevírá skicu na ploše synchronně) a `ERROR_REASON_DOCUMENT_OPEN` (smazání otevřeného dokumentu a přejmenování při otevřené transakci odmítne jako dnes prohlížeč). Jen přidaná pole a hodnota, `buf breaking` projde. ⚠ protože jde o změnu kontraktu zafixovaného v M39.
- **N57 – Otisk požadavku = hex SHA-256 deterministické serializace bez `session_id`, `operation_id` a `read`, z požadavku klienta.** Stejný řetězec jde do SQLite i do paměti sezení. Proč: opakování s jinými `known_meshes` nebo z nového sezení po restartu je tentýž požadavek; operace po opětovném vyřešení skici se může lišit v posledních bitech a nesmí z opakování udělat `OPERATION_ID_REUSED`.
- **N58 – Idempotence kroků transakce = FIFO posledních 64 úspěšných `operation_id` s otiskem v sezení, kontrola pod zámkem dokumentu.** Opakování odpoví aktuálním read modelem bez nového použití; neúspěšný krok se při opakování vykoná znovu. Ids trvalých požadavků a kroků se křížem nekontrolují (chyba klienta). Proč: nejjednodušší, co splní „dvakrát `Apply` = jedno použití“ i při souběhu původního požadavku a jeho opakování po timeoutu klienta.
- **N59 – Timeout nečinnosti uklízí vlákno `reaper` každých 30 s; poslední sezení uvolní běhový dokument i s jádrem.** V testech se volá `reapIdle` s falešnými hodinami. Běhový dokument, na kterém ještě běží RPC, dožije v jeho `shared_ptr`, ale nemá zámek a už nezapíše. Proč: deterministické testy a uvolnění paměti OCCT po zavření dokumentu.
- **N60 – Sítě se tesselují jednou na `(content_version, kvalita)` v mezipaměti běhového dokumentu**, po každé regeneraci ořezané na verze posledního výsledku. Proč: více sezení i každý další read model sdílí jednu tessellaci; verze jiného `input_of` se případně tesseluje znovu (KISS).
- **N61 – Data v `TINYCAD_DATA_DIR` (výchozí `/data`) na svazku `tinycad-data`, timeout v `TINYCAD_SESSION_IDLE_SECONDS` (600).** Epocha procesu z M39 zaniká, restart odliší prefix `content_version` (N43). Proč: dokumenty musí přežít `docker compose restart` a e2e potřebuje vlastní adresář dat (N72).
- **N62 – Spec 14 upravená podle dřívějších rozhodnutí:** formát `content_version` (N43), `STORAGE` → znovunačtení a `NO_TRANSACTION` po zopakovaném `Commit` (N35), opětovné řešení skici před dispečerem i pro `ApplyTransient` a `batch` (N47), směrování `RenameDocument` (N37), otisk (N57), generace (N55), obnovení sezení a `DOCUMENT_OPEN` (N56), primární jméno plochy v `face_names`.

### M46 – Klient nad read modelem

- **N63 ⚠ – Klient drží optimistické zrcadlo dokumentu.** `MirrorDocument` = dokument posledního read modelu + odeslané nepotvrzené změny použité lokálně TS handlery; `RemoteDispatcher` implementuje dnešní `OperationDispatcher`, `Transaction` a `UndoManager` synchronně a každá odpověď zrcadlo přestaví. Proč: dialog featury, skicář i strom čtou dokument hned po `apply`/`dispatch`; s asynchronními porty by se musely přepsat, takto zůstanou beze změny a server je dál autorita. ⚠ protože v klientovi zůstanou handlery operací, `applyOperation` a typy operací i po [[M47-uklid-a-dokonceni|M47]] (ADR 0030 bod 9 počítal s odstraněním celého `ops`); M47 z `ops` odstraní jen log, přehrání, upcast a čtení záznamů.
- **N64 – Undo a redo nejsou optimistické.** Čekají na odpověď (jedna cesta na server); `canUndo`/`canRedo` z read modelu. Proč: inverze záznamů logu klient nemá a undo není častá interaktivní akce.
- **N65 ⚠ – Lokální skica při `SKETCH_NOT_SOLVED` zůstane v zrcadle do dalšího přijatého `setParams` téže skici nebo do konce transakce.** `Commit` zapíše poslední serverem přijatý stav. Proč: splní Q103 („klient ponechá lokální skicu“) jedním pravidlem fasády; ⚠ protože nevyřešená lokální změna se při `Commit` neuloží (UI to hlásí klíčem `sketch.notSolved`).
- **N66 – `render` beze změny: `MeshOps` nad mezipamětí sítí podle `content_version`.** Každá verze dostane stálý syntetický `ShapeHandle`; identita handle = identita verze, takže `syncLayers`, náhled i `SceneSync` fungují jako dnes. Proč: port `MeshOps` už existuje a výměna sítí podle identity handle je přesně výměna podle verze (Q100).
- **N67 ⚠ – Schémata v klientovi z `FeatureTypeDescriptor` s `validate` = `validateAgainstSchema`.** `defaults` z popisu, bez `migrate`, `visibleWhen` jako funkce nad daty; z `FeaturePlugin` se v serverové cestě berou jen `tools`, `manipulators` a `messages` (typ pluginu zúží M47). Proč: Q098 – validace rozhoduje server, generická kontrola je jen pohodlí dialogu. ⚠ protože vlastní pravidla featur (mimo generická) se v dialogu u pole neukážou, jen jako červená featura v read modelu.
- **N68 – Po M46 je server jediná cesta aplikace (konec N3).** `openAppSession` i seznam dokumentů jdou přes server, `VITE_CORE_URL` jen přepisuje výchozí `/api`, `E2E_CORE` zaniká a `test:e2e` běží proti Compose. Lokální `createAppSession`, `doc-lock`, IDB katalog a jejich testy zůstanou v `src/` nezapojené, dokud je M47 nesmaže. Proč: dvě cesty v kompozičním kořeni a dvojí e2e by zdvojily práci a ADR 0030 („do konce M46 WASM běží“) je splněno.
- **N69 – Stav spojení se mapuje na dnešní `KernelUiState` a `PersistenceStatus`.** Připojuji = `starting`, obnovuji = `restarting`, nedostupný = `unavailable`, `retryKernel` = nový pokus; změny v letu = `pending`, opakování = `error`, vzdáno s nepotvrzenými změnami = `failed`. UI dostane jen nové texty. Proč: titulek, banner a tlačítko „zkusit znovu“ už existují.
- **N70 ⚠ – Sezení přežije reload karty přes `sessionStorage` a `resume_session_id`; při `pagehide` best-effort `CloseSession` s `keepalive`.** Proč: dnešní Web Lock se uvolní hned, serverový zámek by po reloadu nechal kartu jen pro čtení. ⚠ protože karta, která spadne bez `CloseSession`, drží zámek až do timeoutu (10 min) a jiná karta je do té doby jen pro čtení.
- **N71 ⚠ – Přenos dokumentů z IndexedDB tlačítkem na úvodní obrazovce (upřesnění N38).** Každý dokument se exportuje dnešním `exportStoredDocument` a pošle `ImportDocument` s `operation_id` = `import:<sha256>` (opakování nezdvojí); IndexedDB se nemaže. Proč: M47 IndexedDB z klienta odstraní, takže pohodlný přenos jde jen v M46; je to jeden malý modul a tlačítko, `tinycad-import` zůstává pro soubory. ⚠ protože N38 tlačítko nechtěl – pokud Pavel dokumenty v prohlížeči nemá, úkol se vypustí.
- **N72 – E2E proti jednomu Compose s vlastním projektem a dočasnými daty; každý test ve vlastním dokumentu.** `docker-compose.e2e.yml` (`tinycad-e2e-<port>`, `tmpfs`, vlastní port Envoy), fixture vytvoří dokument přes `DocumentService`; testy seznamu tvrdí jen o svých dokumentech. Proč: workery sdílejí server (dřív měl každý svou IndexedDB) a e2e nesmí sahat na Pavlova data.
- **N73 – Historie úprav přes úzký port `HistoryLog`** (záznamy bez operací s `opType`, zásobníky ze serveru) místo `OperationLogReader`. Jediná změna rozhraní `interaction` v M46. Proč: `LogEntryView` operace nenese a historie je nepotřebuje.
- **N74 – `remote` smí navíc importovat `document` a `ops` (typy operací, `OP_VERSION`).** Upraví se `.dependency-cruiser.cjs` a tabulka ve [[01-architektura]]. Proč: převody read modelu a operací vrací doménové typy, které app předává portům beze změny.
- **N75 – Zlatý soubor s popisy typů ze serveru** (původně `test/shared-cases/schema/feature-types.json`, podle N88 `test/golden/feature-types.json`). Zapíše ho C++ test M45, TS test M46 z něj staví schémata a pouští sdílené případy `schema.visibleWhen`. Proč: jediný způsob, jak ověřit převod popisu v obou jazycích na stejných datech bez běžícího serveru v unit testech.

### Schválení plánu M45 a M46 (hlavní sezení)

- **N76 ⚠ – Návrhy plánovače M45/M46 přijaté:** doplňky kontraktu N56 (jen přidávají, `buf breaking` je pustí), optimistická kopie dokumentu v klientovi N63 (zužuje [[0030-nativni-jadro-pres-grpc|ADR 0030]] bod 9 – handlery operací zůstanou v klientovi i po M47), N65, N67 a N70 jako méně jisté chování k revizi, tlačítko importu z IndexedDB N71 zůstává (levné; nevím, jestli Pavel v IndexedDB dokumenty má). Proč: bez optimistické kopie by se musel přepsat dialog featur, skicář, strom i vykreslování najednou; s ní se mění jen adaptéry za porty.

## M42 – Jádro OCCT nativně

- **N77 ⚠ – 2D základ (Geom2d křivky, obálky, kontroly křivek) je zatím zdvojený** v `tinycad_kernel` a `tinycad_geometry`. Proč: `tinycad_geometry` ho veřejně nenabízí a stopy běžely souběžně; sloučit do veřejné pomocné knihovny při společné revizi architektury serveru.
- **N78 – Výpisy OCCT (statistiky STEP překladače) ztlumené jednou za proces** na úroveň varování. Proč: zahlcovaly stdout při každém exportu; centrálně v `app` při M45.
- **N79 – Výjimky OCCT převádí každá metoda jádra vlastním `try/catch`** (ne šablonou), `Build` u zaoblení a sražení a zápis STEP jako `OperationFailed`, ostatní `Internal` – stejně jako TS.

## M40 – Dokument a operace v C++

- **N80 – `invert` a `apply` handlerů vrací `Result` s cestou chyby** (`featureId`, `index`, `ops[i].…`), místo výjimky jako v TS. Proč: operace přicházejí od klienta po síti; nesedící operace je očekávaná chyba (`INVALID_OPERATION`), ne chyba programu.
- **N81 – `Dispatcher::begin` vrací `unique_ptr<Transaction>`, zničení otevřené transakce ji zruší** (RAII). Proč: transakce nesmí přežít dispečer ani výjimku v sezení.
- **N82 – Property test přehrání: 200 semínek vlastního generátoru** (TS 1000 běhů fast-check). Proč: rychlost buildu v Dockeru; úmyslná chyba rollback baru se chytila.

## M44 – Model skici a řešič v C++

- **N83 – planegcs ze Salusoft89 commitu `9d26bae`** (značka `v1.3.0` neexistuje; commit odpovídá npm 1.3.0, `gcs_wrapper.ts` bajt po bajtu shodný s `node_modules`). Obal `GcsSystem` vyrenderovaný ručně ze šablony upstreamu (bez Embind), dva malé patche (`Console.h`, `gcs_system.h`), licence LGPL 2.1 v `server/third_party/planegcs/`.
- **N84 – planegcs a adaptér řešiče se překládají s `-ffp-contract=off`.** Proč: WebAssembly nemá fused multiply-add; bez toho by GCC na arm64 slučoval `a*b+c` a výsledky by se od klienta lišily víc.
- **N85 ⚠ – Řešič „bit po bitu jako WASM“ nejde zaručit v plném rozsahu.** Numericky chaotické mezní případy (tečna úsečky a oblouku při tažení) se mohou lišit stavem `ok`/`failed`; sdílené případy jsou zelené. Podle [[Q103 Skica, kterou server nevyřeší|Q103]] platí výsledek serveru.

## M46 – úkol 1 (základy klienta, souběžně s M45)

- **N86 – Selhaný `fetch` je `UNAVAILABLE`** (connect-web ho hlásí jako `Unknown` s příčinou `TypeError`), takže se opakuje se stejným `operation_id`. Proč: jinak by výpadek sítě (e2e `setOffline`) klient neopakoval.
- **N87 – Schéma featury z `FeatureTypeDescriptor` má `migrate`, který odmítne.** Proč: registr vyžaduje `migrate` u verze > 1 (transform v3); data ze serveru jsou vždy v aktuální verzi, migruje jen server.
- **N88 – Zlatý soubor popisů typů je `test/golden/feature-types.json`**, ne v `test/shared-cases/schema/` (N75 upřesněno). Proč: kostra sdílených případů čte každý JSON v oblasti jako případ.
- **N89 – `DocumentView.created_at_ms`** (jen přidané pole). Proč: zrcadlo dokumentu v klientovi potřebuje celé `DocumentMeta`.
- **N90 – Typy klienta zvolené implementátorem úkolu 1 přijaté** (`PlaneData`, `AxisData`, `HistoryData`, `RemoteDocumentSummary`, `Timers`, `ReadModelView`); sítě se z `bytes` vždy kopírují do vlastního bufferu.

## M45 úkol 1 a M46 úkol 4

- **N91 – Index plochy a hrany v `face_names`, `edge_names` a `face_planes` je `SubShapeIndex.index` od 0**, ne `i + 1` (spec 14 a komentáře `.proto` opravené). Proč: `SubShapeIndex` je od 0 v TS i v C++, `i + 1` byl překlep návrhu.
- **N92 – Stav ukládání `failed` při `offline` se řídí čekajícími změnami zrcadla** (fasáda, úkol 3), ne frontou sezení – fronta po vyčerpání pokusů změny vyřeší jako neúspěšné a `pending` klesne na 0, i když zrcadlo změny zahodilo. Zapojení v úkolu 5 M46.
- **N93 – `retain` mezipaměti sítí nezahodí verze, které nese požadavek v letu** (`known_meshes`), jinak by server síť neposlal a klient by ji neměl. Zapojení v úkolu 5 M46.
- **N94 – Klíč `body_id` z `.proto` se v JSON operace jmenuje `body`** (výjimka z pravidla „pole 1:1 v camelCase“, spec 04 a handlery M40 čtou `body`). Otisk požadavku přes OpenSSL `EVP_Digest` (`libcrypto` je v obrazu jako závislost gRPC).
- **N95 – Zlatý soubor popisů typů zapisuje C++ test** (`TINYCAD_UPDATE_GOLDEN=1`), protobuf JSON se jmény polí z `.proto` ve tvaru `{ "feature_types": [...] }`; `test/golden/` je v `.dockerignore` výjimkou a v `.prettierignore`.

## M46 úkol 3

- **N96 – `applyOperation` se exportuje z `ops`** (úkol 5) a fasáda klienta ho použije místo obchvatu přes jednorázový dispečer. Proč: `ops` v klientovi zůstává (N63); zmrazení dovoluje změnu API, kterou vyžaduje přechod na server. Spec 04 doplněna při úkolu 5.
- **N97 – Fasáda nesloučí kroky transakce přes `merge`** (každý `apply` je krok s inverzí, aby šel odebrat právě odmítnutý krok); prozatímní záznam `commit` je `batch` nepřechodných kroků. Read model ze `refresh` při čekajících změnách se odloží do vyprázdnění fronty (jinak by se změna v letu použila dvakrát).
- **N98 – Selhaný `begin` nechá lokální transakci otevřenou, její kroky skončí `NO_TRANSACTION` a zrcadlo se vrátí na základ; selhaný `commit` se jen nahlásí.** Doplní se do spec 14 při M46.

## M46 úkol 2

- **N99 – `keepalive` při zavření karty přes interní hlavičku**, kterou transport z `createCoreTransport` odstraní a pošle `fetch` s `keepalive: true` (connect-web volbu na volání nemá).
- **N100 – Po `SESSION_NOT_FOUND` skončí všechny čekající transakční požadavky (`begin`, `apply`, `applyTransient`, `commit`, `abort`) `NO_TRANSACTION`**; trvalé (`dispatch`, `undo`, `redo`) jdou znovu se stejným `operation_id`. Pozdní `SESSION_NOT_FOUND` z už nahrazeného sezení další sezení neotevře (druhé by bylo jen pro čtení).
- **N101 – Slučuje se jen poslední čekající `apply` se `setParams` téže featury** (užší než plán, stejné jako slučování v `ops/transaction.ts`, nemění pořadí změn). Po vyčerpání pokusů se další čekající změny posílají dál, každá s vlastními pokusy.

## M41 – Persistence v SQLite

- **N102 – `openssl` výslovně ve `vcpkg.json`** (otisky SHA-256 v `storage`, `session` a `tinycad-import`); dosud byl jen závislostí gRPC, z cache se nic nepřestaví.
- **N103 – Svazek dokumentů a práva uživatele `tinycad` v Compose patří do úkolu 5 M45**; `tinycad-import` se spouští `docker compose run --rm --entrypoint tinycad-import -v <složka>:/import core /import`.
- **N104 ⚠ – Poškozené cíle undo v logu při otevření vyhodí výjimku** (`AssertionError` z `UndoManager`) místo `LoadError`; při importu se zachytí jako issue. Známé omezení spec 05; vrstva sezení (M45) výjimku převede na `INTERNAL`.
- **N105 – Dočasný soubor nového dokumentu v režimu rollback journal, WAL až po přejmenování**; kontrola formátu před přepnutím do WAL; čísla v `meta` jako JSON text.

## Revize architektury serveru po M44

Revize (`architecture-reviewer`) nad M39–M44 a pahýly M45 nenašla porušení OOP/KISS ani holé `new`/`delete`; hlavní nálezy jsou souběh vláken pro M45, nekonzistentní chyby a duplicity.

- **N106 – Pravidla vláken a zámků v [[14-protokol#Vlákna a zámky serveru]]** (pod zámkem manageru nic dlouhého, zavření bufferu událostí při uvolnění dokumentu a před vypnutím serveru, zámek procesu pro STEP). Proč: jinak `WatchSession` nikdy neskončí, vypnutí se zasekne a jedna regenerace zablokuje všechna sezení.
- **N107 – Idempotence před řešením skici** (`PersistentDocument::lookup`), prázdný `Commit` si pamatuje sezení, **otisk z kanonického JSON** a jedna funkce `importKey` pro oba importy. Mění N57.
- **N108 – Jedno pravidlo chyb: data zvenku nikdy nehází výjimku** – `rebuildUndoStacks` a `PersistentDocument::open` vrací `LoadError` (uzavírá N104), přehrávání nechytá `std::exception`, řešič chytá jen výjimky planegcs, `bad_alloc` všechny knihovny propouštějí. Opraví stopa A hned.
- **N109 – Levné úklidy hned:** `tinycad_session` linkuje `tinycad_storage` (ne include cesty), solver a jádro se skládají v `app`; `as<T>()` v modelu skici s assertem; limit hloubky vnořených `batch`; `trimJs` do `core`; `document::featureJson`/`readFeature` místo kopií v `ops`; hlavička builderů ve vlastním include adresáři `tinycad_feature_builders`.
- **N110 ⚠ – Na společnou revizi s Pavlem odloženo:** sloučení 2D základu (N77 – `tinycad_geometry` do `tinycad_kernel`, nebo knihovna `occt2d`), vrstva „runtime“ (`PersistentDocument` + `RuntimeDocument` mimo `storage`), read model psaný rovnou do protobufu (N53), `Change.entry` jako JSON mezi knihovnami, přejmenování `OperationLoadError`. Návrh struktury je v revizi; zatím se nic nepřesouvá.

## M43 – Regenerace v C++

- **N111 – Fillet a Chamfer sdílí jednu funkci `buildDressup`**, `NameTable` si jména seřadí sám, `#k` řadí `std::stable_sort` (porovnání s tolerancí není striktní uspořádání). Spouštěč případů `regen` bere nové `OcctKernel` na každý případ.
- **N112 – Property test regenerace ověřuje `liveHandleCount == ownedHandleCount`** a 0 handle po zničení Regeneratoru místo počtu handle v cache (cache není zvenku vidět). Stačí: únik i předčasné uvolnění se projeví.

## Úklid z revize a M44.1

- **N113 – Limit hloubky vnořeného `batch` 64 jen při načítání (`upcastOperation`)**, ne při aplikaci. Proč: transakce a inverze zanořují o 1–3 úrovně hlouběji než operace zvenku; jedna mez by porušila pravidlo M19.1 „co se zapíše, jde přečíst“. Operace ze sítě omezuje protobuf (rekurze 100).
- **N114 – Jádro, 2D geometrie i řešič propouští `AssertionError` a `bad_alloc`**; ostatní výjimky knihoven OCCT a planegcs převádí na chybu jako hodnotu.
- **N115 – `sketch_solve.hpp` zůstává v `features/include`, implementace v `tinycad_feature_builders`**; sezení linkuje `tinycad_feature_builders`. Přesun patří k revizi struktury (N110). Hlavička builderů je v `include-builders/` (N109).
- **N116 – Souběžné buildy C++ v Dockeru (8 GB RAM) s nejvýš `-j3` na agenta.** Proč: při `-j6` čtyř souběžných buildů padal kompilátor na nedostatek paměti.
- **N117 – Čtení logu a souborů nekopíruje surový JSON před kontrolou** (kopie v nlohmann je rekurzivní; 100 000 vnořených `batch` shodilo server na přetečení zásobníku). Nalezeno při implementaci N113.

## M45 úkoly 2 a 3

- **N118 – `regen_progress` jen při regeneraci po změně a jen za skutečně přestavěné featury.** Proč: regenerace běží při každém read modelu (i `GetReadModel` a opakování) a hlásila by i featury z cache; kruhový buffer 256 událostí by se točil a čtenáři by dostávali `resync`. Implementuje úkol 4.
- **N119 – `RuntimeDocument::commit` bere `StepKey` (paměť sezení + klíč)** místo `OperationKey`, aby si prázdný `Commit` pamatovalo sezení (N107); `SessionManager::shutdown()` přidaný do kontraktu (N106). Zámek pro zápis má v běhovém dokumentu vlastní listový zámek, takže `open` pod zámkem manageru nikdy nečeká na běžící změnu; rezervace dokumentu (`nullptr`) platí po dobu načítání i uvolnění.


## Plán M47 – úklid a dokončení

- **N120 ⚠ – Z prohlížeče zmizí jen OCCT WASM; planegcs WASM, worker řešiče a `core/rpc` zůstávají**, stejně jako tři fonty Noto (text ve skice, [[0029-text-ve-skice-pres-opentype|ADR 0029]]) a ikony Tabler. Žádné fonty se neodebírají. Proč: řešič skici zůstává v klientovi ([[0030-nativni-jadro-pres-grpc|ADR 0030]] bod 5); ⚠ protože zužuje cíl M47 „z prohlížeče zmizí WASM“.
- **N121 ⚠ – `ops` v klientovi po M47:** veřejné API jsou typy operací, `OP_VERSION`, registr a handlery, `applyOperation` a typy portů (`OperationDispatcher`, `DispatchMeta`, `Transaction`, `UndoManager`, `LogEntry` v `ops/ports.ts`). Paměťový dispečer, log, transakce a undo se nemažou, ale přesunou se z `index.ts` do `ops/testing.ts` jako testovací dvojník portů; mažou se `replay`, `upcast`, `parse-entry`, `load-error` a `rebuildUndoStacks`. Proč: ≈50 testů `interaction` a `sketcher` staví scénu přes `anOpsSession` a fasádu z `app` v prstenci 1 použít nejde; do bundlu se `testing.ts` nedostane. ⚠ protože poznámka M47 (N63) počítala se smazáním dispečera, transakcí a undo – z produkce zmizí, kód zůstane.
- **N122 – Modul `kernel` zůstává pod stejným jménem jako typy pro `render` a `remote`** (`MeshData`, `MeshQuality`, `ShapeHandle`, `BoundingBox`, `MeshOps`, typy oblastí profilu, chyby jádra, `validateMeshData`); `GeometryKernel`, parsery vstupů, `isRigidMotion`, `FakeKernel` a kontraktová sada zmizí. Proč: přejmenování by sáhlo do ~25 souborů `render` bez přínosu.
- **N123 – `FeaturePlugin` = `{ type, tools?, manipulators?, messages? }`.** Z `features/*` zůstanou nástroje, manipulátory, zprávy, typy parametrů s pomůckami (`params.ts`) a typy kotev (`anchors.ts`); buildery, objekty schémat a `registerPlugin` zmizí. Soulad hlídá test „typy `BUILT_IN_PLUGINS` = typy zlatého souboru popisů“ místo `plugins-parity.test.ts`. Proč: schéma přichází ze serveru (N67), plugin dává jen to, co server neumí.
- **N124 ⚠ – Referenční implementace sdílených případů je po M47 C++.** V TS zůstanou běžce `ops` (druh `script` a handlery nad dvojníkem z N121), `sketch` (řešič a odvozené entity jsou v klientovi) a metatest pokrytí; `geometry`, `regen`, `schema`, `schema-validate` a `document` (s `fromData`/`toData`, pokud je úklid exportů smaže) zmizí. Viditelnost parametrů v TS dál ověřuje test `remote/feature-types` přes `featureSchemaOf`. `cases:record` zapisuje jen `ops` a `sketch`; `expected` nových případů `regen` a `geometry` se zapisuje ručně podle výstupu C++. ⚠ protože záznamový režim C++ je odložený (formát JSON z nlohmann by přepsal celé soubory) a nové případy jádra se tak píšou pracněji.
- **N125 – Měření před a po sérii, ne před a po M47.** „Před“ = commit `main` těsně před sloučením M46 (lokální cesta s WASM, bez serveru), „po“ = konec M47 proti Compose; skript `scripts/measure-startup.mjs` jde stejným scénářem přes UI (nový dokument a kvádr), medián z 5 studených načtení, a k tomu velikosti `dist/assets`. Proč: po M46 už bundler nezapojenou lokální cestu nebalí, rozdíl před a po M47 by byl skoro nulový.
- **N126 ⚠ – Tlačítko přenosu z IndexedDB (N71) zmizí s `persistence`.** Dokumenty z prohlížeče jde po M47 přenést jen z checkoutu před M47 (tlačítko nebo export a `tinycad-import`). Proč: čtení IndexedDB je jediný důvod držet `persistence` a `persistence/idb`; ⚠ protože nevím, jestli Pavel v IndexedDB dokumenty má – uzavření M47 to zapíše do deníku.
- **N127 – Integrační scénáře se před smazáním převedou na sdílené případy `regen`.** Co nemá obdobu v C++ testech ani v případech (topologické pojmenování, regrese oblastí skici, splinu a textu), se zapíše ještě TS regenerací přes `cases:record` a ověří v C++; případ, který v C++ neprojde, je nález, ne úprava `expected`. Proč: integrační testy jsou u některých regresí jediný zápis chování a po smazání TS regenerace by se nedaly zaznamenat.
- **N128 – Specifikace 05, 06 a 07 popisují C++ verzi; TS zápis signatur zůstává jako zápis kontraktu.** Části jen o prohlížeči (adaptér IndexedDB a worker, služba s frontou, worker a volba WASM buildu OCCT, Vite, TS `FakeKernel`) se přesunou do archivní poznámky na spec v `90-archiv/`, nemažou se. Proč: vault nic nemaže a specifikace má popisovat, co běží; přepis signatur do C++ by byl práce bez přínosu, hlavičky jsou v `server/src/*/include`.
- **N129 – Pořadí M47: 1 ∥ 2 → 3 → 4 ∥ 5 ∥ 6 → 7.** Mazání modulů (3) je jeden úkol, protože mazané moduly se navzájem importují a každý mezikrok musí projít `typecheck`; zúžení `ops`/`kernel`/`document` (4), e2e a konfigurace (5) a specifikace (6, hlavní sezení) se soubory nekříží.
