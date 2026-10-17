---
type: milestone
status: todo
order: 42
aliases:
  - M42
  - M42 Jádro OCCT nativně
modules:
  - server
specs:
  - "[[06-geometricke-jadro]]"
  - "[[08-topologicke-pojmenovani]]"
depends_on:
  - "[[M39-kostra-serveru]]"
started:
finished:
tags:
  - milnik
created: 2026-10-17
updated: 2026-10-17
---
# M42 – Jádro OCCT nativně

**Cíl:** Port `GeometryKernel` v C++ nad OCCT z vcpkg ([[M39-kostra-serveru|M39]] zapíše verzi do [[06-geometricke-jadro]]): primitiva, transformace, booleany, plocha a oblasti skici, vysunutí a rotace, zaoblení a sražení, topologie, role a historie, tessellace, STEP. Třída `OcctKernel` za abstraktním rozhraním `GeometryKernel`.

> Upřesněno 2026-10-17 při plánování samostatného běhu ([[Rozhodnutí nativního jádra]], N9–N31). Stopa B souběžných stop po [[M39-kostra-serveru|M39]] ([[Roadmapa#Nativní jádro (M38–M47)]]).

**Specifikace:** [[06-geometricke-jadro]] (hlavně *Kontrakt*, *Výsledek operace a historie*, *Síť pro vykreslení*, *Chyby* a sekce adaptéru), [[08-topologicke-pojmenovani]], [[0030-nativni-jadro-pres-grpc|ADR 0030]]

**Navazuje na:** [[M39-kostra-serveru]] a úkol 0 hlavního sezení (`tinycad_core`, podpora testů)

**Zdroj pravdy o chování:** `src/kernel/kernel.ts`, `types.ts`, `profile.ts`, `mesh.ts`, `transform.ts`, kontraktová sada `src/kernel/testing.ts` (3D části) a adaptér `src/kernel-occt/*` s testy `test/unit/kernel-occt/*`. 2D metody portu (`curveIntersections`, `curveSegment`, `filletArc`, `offsetCurves`) jsou v `tinycad_geometry` z M39 a sem nepatří (N15).

## Úkoly

- [ ] 1. Kostra knihovny, tabulka tvarů, `makeBox`, dotazy a životnost handle
- [ ] 2. Válec, transformace, boolean, topologie a tessellace (souběžně)
- [ ] 3. Plocha skici, vysunutí a rotace s rolemi (souběžně)
- [ ] 4. Oblasti skici `profileRegions` (souběžně)
- [ ] 5. Zaoblení, sražení, STEP a paměťový test

Úkol 1 jde první a sám: založí všechny zdrojové soubory s pahýly, takže úkoly 2–5 mění každý jen své soubory (N30). Úkoly 2, 3 a 4 běží souběžně (tři subagenti `implementer`), 5 hned, jak se uvolní místo (potřebuje jen úkol 1).

## Akceptační kritéria

- C++ kontraktová sada (GoogleTest, port 3D částí `src/kernel/testing.ts` a testů `test/unit/kernel-occt/*` pro modelování, plochu, oblasti, tažení, topologii, historii, zaoblení, STEP a tessellaci) je zelená nad OCCT z vcpkg. Sdílené případy jádra z M38 neexistují (M38 zapsal `regen`, ne jádro); chování jádra v sestavě ověří sdílené případy `regen` v [[M43-regenerace-v-cpp|M43]] (N26 ⚠).
- Paměťový test: 200 kol (kvádr, boolean, zaoblení, tessellace, uvolnění) nezvětší RSS procesu po zahřátí o víc než 20 MB a `liveHandleCount()` je na konci 0 (N31). [[Q054 Únik paměti v OCCT buildu|Q054]] a [[Q055 Pád WASM jádra|Q055]] se uzavřou jako specifické pro WASM build.
- Knihovna `tinycad_kernel` nezávisí na dokumentu, regeneraci ani gRPC; typy OCCT nejsou ve veřejných hlavičkách.

## Implementační plán

Jeden úkol = jedno spuštění subagenta `implementer` (Opus, TDD). Pro všechny úkoly:

- **OOP a KISS** (Pavel, N9): čitelné objektové C++ – `OcctKernel` implementuje abstraktní `GeometryKernel`, vnitřek je pár tříd s jednou odpovědností (`ShapeTable` s `ShapeEntry`, `HistoryCollector`, pomocníci pro role), RAII pro všechno, co drží OCCT. Žádné šablonové metaprogramování, žádné funkcionální řetězce, žádná akrobacie s `std::variant`; `switch` nad `Curve2::kind`. Nejjednodušší kód, který projde kontraktovou sadou. Objekty OCCT přes `Handle(...)` a hodnoty, nikdy holé `new` bez vlastníka.
- **Kontrakt:** zafixované hlavičky `server/src/kernel/include/tinycad/kernel/{kernel,types,errors,profile,mesh,occt_kernel}.hpp` (N13–N16). Implementátor je **nemění** (výjimka: jména parametrů, `#include`); chybějící věc vrací jako otázku.
- **Chyby:** každá veřejná metoda obalí tělo jedním pomocníkem (např. `guarded(method, fn)`), který chytí `Standard_Failure` a `std::exception` a vrátí `KernelError` s kódem podle kontraktu metody (spec 06: `OperationFailed` u selhání algoritmu, jinak `Internal`); signálové handlery OCCT (`OSD::SetSignal`) se neinstalují.
- **Build a testy:** knihovna `tinycad_kernel` v `server/src/kernel/CMakeLists.txt` (OCCT moduly jen modelovací a `TKDESTEP`/`TKXSBase` pro STEP, N25), testy `server/test/kernel/<oblast>_test.cpp` ve spustitelném `tinycad_kernel_tests`. Tolerance z kontraktové sady (bbox 1e-6 u kvádru, jinak 1e-5, normály 1e-4). Ověřuje se v Dockeru cíleně (`ctest -R kernel`).
- **Zdroj:** každý úkol uvede, ze kterých bloků `describe` sady a ze kterých TS souborů adaptéru vychází; co se v C++ nedá nebo nemá smysl (izolace vstupů, `postMessage`, WASM trap) vynechá a uvede v hlášení.

### 1. Kostra, tabulka tvarů, `makeBox`, dotazy a životnost

- **Soubory:** `server/src/kernel/CMakeLists.txt`; `src/occt_kernel.cpp` (`OcctKernel` + `Impl`, metody jen delegují do souborů níže), `src/shape_table.{hpp,cpp}` (`ShapeEntry`: `TopoDS_Shape`, `TopTools_IndexedMapOfShape` ploch, hran a vrcholů spočtené jednou, role hran z `makeFace`; `ShapeTable`: rostoucí čítač handle, `add`, `find`, atomické `release`, `liveCount`), `src/guarded.{hpp,cpp}` (převod výjimek), `src/history.{hpp,cpp}` (`HistoryCollector` podle spec 06 *Historie, role a topologie v adaptéru*: modified/deleted ploch vstupů, generated ploch výstupu, úplnost a pořadí), `src/errors.cpp`, `src/mesh.cpp` (`validateMeshData`, `isRigidMotion`), `src/profile.cpp` (`validateFaceInput`, `parseProfileRegionsInput` – port kontrol z `src/kernel/profile.ts`), `src/primitives.cpp` (`makeBox` s rolemi), `src/query.cpp` (`boundingBox` přes `BRepBndLib::AddOptimal` bez tolerance tvaru). **Pahýly** vracející `Internal` „not implemented“ pro ostatní metody v souborech `primitives.cpp` (válec), `transform.cpp`, `boolean.cpp`, `topology.cpp`, `tessellate.cpp`, `face.cpp`, `sweep.cpp`, `regions.cpp`, `dressup.cpp`, `step.cpp` – CMake je zná od začátku.
- **Testy:** bloky `errors` (neznámý handle u všech metod, neplatné vstupy `makeBox`), `makeBox`, `boundingBox`, `release`, `liveHandleCount`, `handles`; unit testy `validateMeshData`, `isRigidMotion`, `validateFaceInput`, `parseProfileRegionsInput` (port `test/unit/kernel/{mesh,transform,profile}.test.ts`); `HistoryCollector` na booleanu dvou kvádrů přímo přes OCCT API.
- **Hotovo když:** testy zelené, všechny metody existují (pahýly), handle se nikdy nepoužije znovu, neúspěšná operace handle nevytvoří.

### 2. Válec, transformace, boolean, topologie a tessellace (souběžně)

- **Soubory:** `src/primitives.cpp` (`makeCylinder` s rolemi `face:bottom|top|side`), `src/transform.cpp` (`BRepBuilderAPI_Transform`, přenos rolí hran přes `Modified`), `src/boolean.cpp` (`BRepAlgoAPI_Fuse/Cut/Common` s více argumenty a nástroji, výsledek bez solidu → `OperationFailed`, historie vstupů `[...targets, ...tools]`), `src/topology.cpp` (spec 06 *Topologie*: typ plochy, rovina s normálou ven, sousednost hran, vrcholy, střed hrany), `src/tessellate.cpp` (`BRepMesh_IncrementalMesh`, ploché pole podle `MeshData`, normály ven, plocha bez trojúhelníků se do `faceRanges` nezapíše; port `kernel-occt/tessellate.ts`).
- **Testy:** bloky `makeCylinder`, `transform`, `boolean`, `topology (M14)`, `tessellate`, `tessellate a box`, role a historie těchto operací z bloků `roles (M14)` a `history (M14)`; `test/unit/kernel-occt/{occt-modeling,occt-topology,tessellate}.test.ts`.
- **Hotovo když:** uvedené bloky zelené, `validateMeshData` prázdné pro každou síť z testů.

### 3. Plocha skici, vysunutí a rotace s rolemi (souběžně)

- **Soubory:** `src/face.cpp` (`makeFace`: 2D křivky `GC_MakeSegment2d`, `GC_MakeArcOfCircle2d`, `GC_MakeCircle2d`, `Geom2d_BSplineCurve`, hrany na rovině, role `edge:<id>` přes hrany z `MakeWire.Edge()` a `ShapeFix_Face`, díry; port `kernel-occt/face.ts`), `src/sweep.cpp` (`BRepPrimAPI_MakePrism` a `MakeRevol`, kontroly vstupu, `face:start`/`face:end`/`face:side:<id>`, náhradní hledání boční plochy při rotaci o 2π; port `kernel-occt/sweep.ts`). Převod `Curve2` → `Geom2d_Curve` převezme z `tinycad_geometry` (M39), pokud ho knihovna nabízí veřejně; jinak vlastní v `face.cpp` a hlášení to uvede.
- **Testy:** bloky `makeFace`, `extrude`, `revolve` a jejich role a historie; `test/unit/kernel-occt/{occt-sketch,occt-sweep,occt-history}.test.ts`.
- **Hotovo když:** uvedené bloky zelené; rotace o 2π i o úhel < 2π dá očekávané role.

### 4. Oblasti skici `profileRegions` (souběžně)

- **Soubory:** `src/regions.{hpp,cpp}` – port algoritmu `src/kernel-occt/regions.ts` podle spec 06 *Oblasti skici v adaptéru (M30)*: uzly koncových bodů s tolerancí, křížení přes `Geom2dAPI_InterCurveCurve` (dvojice s překrytými obálkami, spline sám se sebou), polohrany a `next(e)`, znaménková plocha Greenovým integrálem (Gauss–Legendre), díry paritou paprsku, výstup ze vstupních křivek otočených podél smyčky (N29: stejný algoritmus jako TS, ne `BOPAlgo`/`BRepAlgoAPI_Splitter`, aby jména a `crossing` seděly se sdílenými případy `regen`).
- **Testy:** bloky `regions (spec 12 Oblasti)`, `regions with splines (M29)`, `input (spec 06 profileRegions)`; `test/unit/kernel-occt/occt-regions.test.ts`; výkon: mřížka 1860 úseček pod 1 s (TS adaptér ~110 ms).
- **Hotovo když:** uvedené bloky zelené (jména a `crossing` přesně, plocha relativně 1e-6, spline 1e-3, body smyček do `1e-7 · max(1, |souřadnice|)`).

### 5. Zaoblení, sražení, STEP a paměťový test

- **Soubory:** `src/dressup.cpp` (`BRepFilletAPI_MakeFillet`/`MakeChamfer`, kontrola `Contour(edge) != 0` po každém `Add`, selhání → `OperationFailed`, historie; port `kernel-occt/dressup.ts`), `src/step.cpp` (`STEPControl_Writer` do dočasného souboru v `std::filesystem::temp_directory_path()` s jedinečným jménem, smazaným v destruktoru pomocné třídy, AP214, mm; víc tvarů jako `TopoDS_Compound`), `server/test/kernel/memory_test.cpp` (RSS z `/proc/self/statm`, N31).
- **Testy:** zaoblení a sražení z bloků `errors`, `roles`, `history` a `test/unit/kernel-occt/occt-dressup.test.ts` (příliš velký poloměr, šev válce → `OperationFailed`); `exportStep (M15)` a `occt-step.test.ts` (zpětné načtení `STEPControl_Reader` dá stejný počet solidů a obálku); paměťový test podle akceptačních kritérií.
- **Hotovo když:** testy zelené, celá sada `tinycad_kernel_tests` zelená v jednom běhu, revize `architecture-reviewer` na konci milníku.

## Co se naučíš

Nativní OCCT a rozdíly proti WASM buildu (výjimky místo pastí, plné API bez omezení buildu), správa paměti `Handle(Standard_Transient)` a RAII, pimpl jako hranice, za kterou OCCT nepronikne.

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Retrospektiva

_(vyplnit po dokončení; obecné poznatky přesunout do `70-poznatky/`)_
