---
type: spec
status: implemented
order: 6
aliases:
  - "06-geometricke-jadro v prohlížeči"
  - Jádro v prohlížeči
  - kernel-occt
modules:
  - kernel
  - kernel-occt
milestones:
  - "[[M05-kernel-port]]"
  - "[[M07-kernel-occt]]"
  - "[[M11-dalsi-entity]]"
  - "[[M12-skicar]]"
  - "[[M13-extrude-revolve]]"
  - "[[M14-topologicke-pojmenovani]]"
  - "[[M15-export-a-dokonceni]]"
  - "[[M16-vlastni-occt-build]]"
tags:
  - spec
  - archiv
created: 2026-10-17
updated: 2026-10-17
---
# 06 – Geometrické jádro v prohlížeči (archiv)

Archivováno v [[M47-uklid-a-dokonceni|M47]] ([[Rozhodnutí nativního jádra|N128]]). Platná specifikace je [[06-geometricke-jadro]]. Text níže popisuje verzi v prohlížeči do [[M46-klient-nad-read-modelem|M46]]: adaptér `kernel-occt` (OpenCascade ve WASM ve Web Workeru, [[0002-occt-wasm-ve-workeru|ADR 0002]], [[0013-replicad-opencascadejs|ADR 0013]]) a TS `FakeKernel`. Kód smazal úkol 3 M47, je v historii gitu před M47. Text je přesunutý beze změny; odkazy na nadpisy, které zůstaly ve specifikaci, vedou do [[06-geometricke-jadro]].

## Implementace jádra do M46 (úvod specifikace)

- **Nativní OCCT na serveru** (od [[M39-kostra-serveru|M39]], [[0030-nativni-jadro-pres-grpc|ADR 0030]]): **OCCT 8.0.1** z registru vcpkg (baseline `a5f73622`, triplet `arm64-linux-release`), knihovny v `server/src/` (2D geometrie skicáře `tinycad_geometry` za `GeometryService`). Dokud [[M46-klient-nad-read-modelem|M46]] nepřepne klienta, běží v prohlížeči dál WASM verze níže.
- **OCCT** (`kernel-occt`): OpenCascade ve WASM, běží ve Web Workeru ([[0002-occt-wasm-ve-workeru|ADR 0002]]). Tovární funkce `createOcctKernel(): Promise<GeometryKernel & Disposable & { onDisconnected }>` (počká na start workeru) – M7.
- **Fake** (`kernel`): jednoduchá implementace v paměti pro testy vyšších vrstev, každý tvar drží jen jako AABB (od M11 i válec, transformace a boolean, [[#`FakeKernel`]]). `createFakeKernel(): FakeKernel` z `kernel/testing.ts` – M5.

## Zmínky workeru a fake v ostatních částech specifikace

Původní znění odrážek, které specifikace po M47 popisuje pro C++ (oddíly *Stav po M30*, *Stav po M33*, *Stav po M34*, *Stav po M35* a *Chyby*):

- **Klient workeru** posílá vstup i výsledek jako strukturovaná data (`postMessage`), bez handle; `TrackingKernel` regenerace ho jen přeposílá (nic neuvolňuje).
- **`curveIntersections`:** vstup jako u `profileRegions` (`parseProfileRegionsInput`: id povinné a unikátní, nulové délky vynechané). Průsečíky i ve sdílených koncových bodech a tečné dotyky; překryv → oba konce společného úseku s `overlap`. Body se slučují do `1e-7 · max(1, |souřadnice|)`. Uzel uzavřeného splinu se hlásí jako samoprůsečík (`ta` první, `tb` poslední uzel). **Nehlásí se:** dvě shodné kružnice (překryv bez konců) a překryv se splinem. OCCT hlásí tečný dotyk jako krátký společný úsek; adaptér ho podle mezery uvnitř úseku převede na jeden bod. OCCT: `Geom2dAPI_InterCurveCurve` s předfiltrem obálek (jako oblasti), parametry přes `Geom2dAPI_ProjectPointOnCurve` (`InterCurveCurve` je nevrací), převedené na `t` ze spec 12. Fake: vzorce z `fake-regions.ts`, spline vzorkováním úseků mezi uzly a Newtonem na přesné křivce (tessellace by bodovou toleranci nesplnila). Kód: `kernel/fake-curves.ts`, `kernel-occt/curves.ts`, sdílená stavba 2D křivek a předfiltr obálek `kernel-occt/geom2d.ts`.
- **`curveSegment`:** křivka podle tvaru z `makeFace` (bez povinného id), `from < to` v definičním oboru (`t` ze spec 12; u kružnice `to < from + 2π` – celá otáčka by byl oblouk nulové délky), jinak `'invalid-input'`; parametr do `1e-9 · max(1, |mez|)` za mezí se posune na mez. Kontrolu sdílí obě jádra: `parseCurveSegmentInput(p: unknown): Result<CurveSegmentInput, readonly string[]>` z `kernel`. Úsečka a oblouk přesně ze vzorců; spline `Geom2d_BSplineCurve.Segment(from, to)` (fake: vkládání uzlů v TS), uzly kusu přeškálované do `[0, 1]`. Body kusu leží na původní křivce (kontraktová sada vzorkuje).
- OCCT: `Geom2d_OffsetCurve(±radius)` nosné geometrie – úsečka jako `Geom2d_TrimmedCurve(Geom2d_Line)` na `±1e6 · měřítko` kolem `from` (`InterCurveCurve` na ekvidistantě nekonečné přímky vyhodí výjimku; střed dál než tato mez → `'operation-failed'`, fake ho najde – mimo kontrakt), oblouk jako `Geom2d_Circle`; průsečíky `Geom2dAPI_InterCurveCurve` (tečný dotyk hlášený jako úsek jako v M33), body dotyku `Geom2dAPI_ProjectPointOnCurve`. Degenerovaná ekvidistanta oblouku (`|ρ − r|` v toleranci) se vynechá. Kód `kernel-occt/fillet.ts`. Fake: analyticky (`kernel/fake-fillet.ts`). Kontrola vstupu `parseFilletArcInput` z `kernel`.
- Fake: úsečky, oblouky a kružnice analyticky (průsečíky sousedních ekvidistant, bez zániku hran); spline a zánik → `'operation-failed'` (kontraktová sada je nezkouší).
- **Více chyb najednou** (např. neznámý handle i neplatná kvalita): který kód se vrátí, není určeno a sada to netestuje. `FakeKernel` dává přednost chybě z `failNext`.
- **Izolace:** jádro si neponechává odkaz na vstupní objekty (`origin`, `size`, `base`, `axis`, matice, pole handle) a **čte je synchronně při volání**, jako by je klonoval `postMessage`. Změna vstupu hned po volání (před `await`) výsledek neovlivní. Vrácená data nesdílí paměť s ničím jiným. Když čtení vstupu selže (vstup mimo typy, např. `null`), je to také odmítnutý `Promise`, ne synchronní výjimka (u `makeFace` a `profileRegions` s kódem `'invalid-input'`, protože jejich kontrola vstupu přijímá `unknown`; jinde `'internal'`).
- Neočekávaná výjimka uvnitř implementace (chyba v adaptéru, výjimka OCCT) se převede na `'internal'`.
- `regen` chybu s kódem jádra zachytí a označí featuru jako chybnou (`KERNEL`), regenerace pokračuje. Chyba bez kódu jádra chybou featury není: `RpcError` `'disconnected'` ([[Q037 Pád workeru a čekající RPC volání|Q037]]) znamená, že jádro zaniklo – `run` odmítne a `regen` zahodí cache i vlastněné handle ([[Q049 Pád jádra během regenerace|Q049]]); jiná výjimka je chyba programu ([[Q043 Výjimka builderu mimo jádro|Q043]]).

## `kernel-occt`: architektura adaptéru

```
hlavní vlákno                               Web Worker
┌───────────────────────────┐   rpc    ┌──────────────────────────────────────┐
│ createOcctKernel()        │ ───────► │ occt.worker.ts                       │
│  Worker + RpcClient       │          │   serveRpc(createOcctWorkerImpl(     │
│  createOcctKernelClient   │ ◄─────── │     loadOcct() → OcctKernelImpl))    │
│  → GeometryKernel         │ transfer │ OcctKernelImpl                       │
│    & Disposable           │          │   Map<ShapeHandle, ShapeEntry>       │
└───────────────────────────┘          │   tessellateEntry (BRepMesh)         │
                                       │ OCCT WASM modul                      │
                                       └──────────────────────────────────────┘
```

- `createOcctKernel()` (jediný veřejný export) vlastní worker a klienta RPC. `createOcctKernelClient` je tenký, jen převádí volání na RPC a dostane z klienta RPC jen `call` (`failAll`/`dispose` patří vlastníkovi workeru). Chyby nepřevádí, kód přežije v `RpcError`.
- `createOcctWorkerImpl(init: Promise<GeometryKernel>)` je strana workeru: implementace protokolu, která na každé volání počká na inicializaci ([[#Start workeru a `ready`]]).
- `OcctKernelImpl` drží soukromou `Map` handle → `ShapeEntry` ([[06-geometricke-jadro#Datové struktury na obou stranách]]) a veškerou práci s OCCT. Modul OCCT dostane v konstruktoru (nenačítá ho sám), takže jde testovat přímo v Node bez workeru. Všechny OCCT objekty vytvořené v metodě uvolňuje deklarací `using` (embind objekty mají `[Symbol.dispose]`, který volá `.delete()`), `try/finally` jen tam, kde objekt opouští rozsah ([[0013-replicad-opencascadejs|ADR 0013]]).
- Inicializace WASM proběhne jednou při startu workeru (v prohlížeči ~300 ms, v Node ~100 ms), klient vystaví `ready: Promise<void>`.
- Worker zpracovává požadavky sériově. Dlouhé operace (fillet) blokují další, pro začátek je to přijatelné.
- **Mapy podtvarů:** zvolený build nemá svázané `TopExp::MapShapes` ani `TopTools_IndexedMapOfShape`. Jediný pomocník adaptéru je počítá stejným algoritmem: `TopExp_Explorer(shape, typ)` a přidání podtvaru, jen pokud v seznamu ještě není podtvar `IsSame`. Pořadí, a tedy i `SubShapeIndex`, je proto stejné jako u `MapShapes`. Cena je O(n²) volání `IsSame`.
- **Výjimky OCCT** přicházejí jako `WebAssembly.Exception`. Adaptér je přes `getExceptionMessage` převede na chybu `'internal'` se zprávou `<typ OCCT>: <zpráva>`, při prázdné zprávě jen `<typ OCCT>`. `'operation-failed'` z převodu výjimky nevzniká: operace, které běžně selhávají (boolean, fillet – M11+), kontrolují `IsDone()` a tuto chybu vyhodí samy. Výjimka se po přečtení zprávy uvolní (`oc.decrementExceptionRefcount(e)` v `occtExceptionText`). C++ výjimka, která doletí do JS, má počítadlo referencí 1 a žádný C++ `catch` ji neuvolní, takže by na haldě zůstalo asi 140 B na výjimku (M19.1). Každá taková výjimka navíc nechá ukazatel zásobníku Emscriptenu posunutý o 32 B. Build nevystavuje `stackRestore`, takže po ~262 000 výjimkách přijde trap (viz doplněk [[Q055 Pád WASM jádra|Q055]]) a řeší ho restart jádra. Pád samotného WASM je **fatální**. Fatální chyby rozpoznává `isWasmTrap`:
  - `WebAssembly.RuntimeError`: trap, `unreachable`, nedostatek paměti, „function signature mismatch“;
  - přetečení zásobníku: `RangeError` se zprávou o call stacku, ve Firefoxu `InternalError: too much recursion`. Ostatní `RangeError` (alokace pole) fatální nejsou;
  - `SuppressedError` z `using` se rozbalí rekurzivně (`error` i `suppressed`), od M19.1, stejně v kopii pro planegcs.

  Fatální pád ([[Q055 Pád WASM jádra|Q055]], od M10) proběhne takto: ([[Q055 Pád WASM jádra|Q055]], od M10): worker nejdřív pošle notifikaci `{ type: 'fatal', message }` (bez `id`, RPC klient ji přeskočí) a teprve pak odpoví na volání chybou; klient na notifikaci zavolá `failAll` → všechna čekající volání **včetně toho, které trap vyvolalo**, i další volání skončí `'disconnected'` a worker se ukončí. Požadavky, které ve workeru čekají po trapu, worker k jádru nepustí. `toKernelError` trap nepřevádí na `'internal'`, nechá ho projít. Jádro po trapu už nic nepočítá, protože jeho paměť může být poškozená. Nové jádro vytvoří `app` ([[11-ui]]); `regen` po `'disconnected'` zahodí cache a handle ([[Q049 Pád jádra během regenerace|Q049]]). Vlastní build ([[M16-vlastni-occt-build]]) trapy jen omezí, neodstraní.
- **Vite:** WASM se načítá přes `import wasmUrl from 'replicad-opencascadejs/wasm?url'` a `locateFile: () => wasmUrl`, balík je v `optimizeDeps.exclude`, worker má `format: 'es'`. Import s dotazem `?url` dependency-cruiser nevyřeší (bere `?url` jako část podcesty `exports`), proto ho pravidlo `not-to-unresolvable` vynechává a hlídá ho zvláštní pravidlo `<modul>-allowed-npm-assets` se stejným seznamem npm balíků ([[01-architektura]]). Překlep v takové cestě odhalí až `vite build`. `vite build` hlásí neškodné varování: `node:module` z kódu Emscriptenu pro Node se v prohlížeči nahradí prázdným modulem.
- **`using` v prohlížeči:** Vite 8 deklaraci `using` převádí na pomocnou funkci, která hledá `Symbol.dispose ?? Symbol.for('Symbol.dispose')`. Embind ale metodu `[Symbol.dispose]` přidá jen tehdy, když `Symbol.dispose` existuje. Worker proto **před** inicializací OCCT doplní `Symbol.dispose = Symbol.for('Symbol.dispose')`, **jen pokud chybí** (v TS přes `Object.defineProperty`, vlastnost je deklarovaná jako readonly), aby obě strany použily stejný symbol i v prohlížeči bez nativní podpory.

### Start workeru a `ready`

Modulový worker inicializuje OCCT asynchronně. Zpráva, která do workeru dorazí dřív, než si zaregistruje posluchače, se ztratí. Proto:

1. `occt.worker.ts` zavolá `serveRpc` **hned synchronně** při startu. Implementace drží `Promise<OcctKernelImpl>` a každá metoda nejdřív počká na něj.
2. Protokol `OcctKernelProtocol` = metody `GeometryKernel` + `ready(): void`. `ready` počká na inicializaci. Selhání inicializace (nenalezený WASM…) se tak dostane ke klientovi jako odmítnutí (`'internal'` se zprávou), ne jako neodchycená výjimka ve workeru, kterou `worker.onerror` nezachytí. Implementace selhání inicializace hned označí jako ošetřené (`catch`), aby z něj ve workeru nebylo neošetřené odmítnutí, dokud se nikdo nezeptá; každé další `await` přesto odmítne.
3. `createOcctKernel()` vytvoří worker, napojí `onerror`/`messageerror` na `rpc.failAll`, počká na `ready` a vrátí `GeometryKernel & Disposable & { onDisconnected }`. `onDisconnected` přeposílá `RpcClient.onDisconnected`, takže jádro splní port `SupervisedKernel` ze spec 11 (M19.1). Když `ready` selže, worker ukončí a odmítne: chyba inicializace OCCT → `'internal'`; worker, který vůbec nenaběhne (404, chyba skriptu) → `onerror` → `'disconnected'`. `dispose()` = `rpc.dispose()` + `worker.terminate()`.
4. Klient výsledek `tessellate` jen předá: buffery přišly přes `transfer`, worker o ně přišel (kontrakt nových bufferů tím platí automaticky).

### Tessellace v adaptéru

- `BRepMesh_IncrementalMesh(shape, linearDeflection, false, angularDeflection, false)`: absolutní průhyb, bez paralelismu (worker je jednovláknový).
- Plochy v pořadí mapy podtvarů (`SubShapeIndex` = pozice). Každá plocha má **vlastní vrcholy** (žádné sdílení mezi plochami), aby šly normály ostrých hran a `faceRanges`. Uzly triangulace se transformují `TopLoc_Location` plochy.
- Plocha s orientací `TopAbs_REVERSED`: prohodí se pořadí dvou vrcholů každého trojúhelníku a otočí normály, aby trojúhelníky byly CCW při pohledu zvenku.
- Normály z OCCT: `BRepLib_ToolTriangulatedShape.ComputeNormals(face, triangulation)` spočte normálu skutečné plochy v UV bodu každého uzlu (`GeomLib::NormEstim`); kde normála plochy není definovaná (pól koule), OCCT sám vezme průměr normál trojúhelníků v uzlu. Normály uloží do triangulace (`Poly_Triangulation.Normal(i)`) v souřadnicích plochy **bez** lokace a **bez** ohledu na orientaci plochy. Adaptér je proto otočí lokací (`gp_Dir.Transform(trsf)`, jen rotační část) a u plochy `TopAbs_REVERSED` obrátí. Nahrazuje dřívější vlastní průměr normál trojúhelníků (M11, [[Rozhodnutí noční rychloakce#M11 – Další entity|R21]]), který na švu a okraji pláště válce ujížděl o polovinu úhlového kroku; změna podle přání co nejvíc používat OCCT ([[Q088 Geometrie skici v TypeScriptu nebo v OCCT|Q088]]). Plocha, jejíž triangulace normály nedostane (`HasNormals()` je `false`), se vynechá jako plocha bez trojúhelníků.
- Lokace se aplikují přes `gp_Trsf.Transforms(x, y, z)` (bez nového objektu OCCT na uzel). **Zrcadlící lokace** (`gp_Trsf.IsNegative()`) by otočila navinutí; nevznikne, protože `transform` přijímá jen tuhé pohyby (M11).
- Hrany v pořadí mapy podtvarů. Polyline z `BRep_Tool.PolygonOnTriangulation(edge, loc)`: OCCT vybere první reprezentaci hrany na triangulaci sousední plochy a vrátí polygon, tu triangulaci a složenou lokaci. Uzly polygonu jsou indexy do vrácené triangulace, transformují se vrácenou lokací. Degenerovaná hrana, hrana bez polygonu nebo s méně než 2 body se do `edgeRanges` nezapíše (jako plocha bez trojúhelníků).
- Chybějící triangulaci nebo polygon vrací binding jako JS `null`, i když `.d.ts` slibuje objekt; adaptér na `null` testuje explicitně.
- Výsledek se kopíruje do nových typed arrays, každé s vlastním `ArrayBuffer` ([[06-geometricke-jadro#Síť pro vykreslení]]).

### Modelovací operace v adaptéru (M11)

- **Válec:** `BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(base), gp_Dir(axis)), radius, height)`. Má 3 plochy (plášť, dvě podstavy) a 3 hrany (dvě kružnice a šev).
- **Transformace:** `gp_Trsf.SetValues(a11 … a34)` po řádcích (`a_rc = m[c*4 + r]`, `Mat4` je po sloupcích) a `BRepBuilderAPI_Transform(shape, trsf, false)`. Tuhý pohyb jen nastaví lokaci, geometrie (`TShape`) se nekopíruje a sdílí s původním tvarem; tessellace lokaci ploch aplikuje.
- **Boolean:** prázdný konstruktor `BRepAlgoAPI_Fuse | Cut | Common`, `SetArguments(cíle)`, `SetTools(nástroje)` (seznamy `NCollection_List_TopoDS_Shape`; `Append` vrací nový obal `TopoDS_Shape`, který adaptér smaže), `Build()`. `HasErrors()` → `'operation-failed'`; výsledek bez solidu (`TopExp_Explorer(výsledek, TopAbs_SOLID).More()` je `false`) → `'operation-failed'`.

### Rovinná plocha v adaptéru (M12)

- Rovina `gp_Ax3(gp_Pnt(origin), gp_Dir(normal), gp_Dir(xDir))`, `gp_Pln(ax3)`; bod roviny `(x, y)` → `origin + x·xDir + y·yDir` (`plane.toWorld` z `core`).
- Hrany: úsečka `BRepBuilderAPI_MakeEdge(gp_Pnt, gp_Pnt)`; oblouk `BRepBuilderAPI_MakeEdge(gp_Circ, P1, P2)` s `gp_Circ(gp_Ax2(střed, normal, xDir), r)` – kružnice v OCCT běží proti směru hodinových ručiček kolem `normal`, takže pro `ccw: false` se body prohodí; kružnice `BRepBuilderAPI_MakeEdge(gp_Circ)`.
- Smyčka `BRepBuilderAPI_MakeWire` (`Add` po hranách, `IsDone()` jinak `'operation-failed'`); plocha `BRepBuilderAPI_MakeFace(gp_Pln, outerWire, true)`, díry `Add(holeWire)`, pak `ShapeFix_Face(face).FixOrientation()` (srovná orientaci děr; samotné `Perform()` to nestačí, ověřeno v M12) a `BRepCheck_Analyzer(face).IsValid()` jinak `'operation-failed'`. Všechny objekty OCCT přes `using`.

- **B-spline (M29):** `Geom_BSplineCurve(Poles: NCollection_Array1_gp_Pnt, Knots: NCollection_Array1_double, Multiplicities: NCollection_Array1_int, Degree)` ve 3D (řídicí body převedené `plane.toWorld`, pole s dolní mezí 0 – OCCT je přijme), uzly zkomprimované na unikátní hodnoty a násobnosti (build neexportuje `BSplCLib`), hrana `BRepBuilderAPI_MakeEdge(Geom_Curve)`. Adaptér nic nevzorkuje ani neaproximuje; platnost hlídá stávající `BRepCheck_Analyzer` (spline křížící jinou stranu → `'operation-failed'`). Měření plochy v testech potřebuje přesnou variantu `BRepGProp.SurfaceProperties(shape, props, 1e-9, false)` – výchozí se u plochy se splinem plete o ~2e-4 relativně.

### Oblasti skici v adaptéru (M30)

`kernel-occt/regions.ts` (`profileRegionsOf`). Cesta zvolená prototypem ([[M30-geometrie-skici-v-occt#Průběh stopy|M30]]): build neváže `BOPAlgo_Builder`, `BOPAlgo_Tools`, `IntAna2d`, `GCE2d` ani klasifikátory bodu v ploše (`BRepClass_FaceClassifier`, `BRepTopAdaptor_FClass2d`); `BRepAlgoAPI_Splitter` nepozná spline křížící sám sebe, visící hranu nechá v ploše a trojúhelník dotýkající se obdélníku rohem udělá dírou. Proto algoritmus kontraktu (spec 12 *Oblasti (profily)*) s geometrií z OCCT:

- Vstup zkontroluje `parseProfileRegionsInput` (sdílený s fake). 2D křivky `GC_MakeSegment2d`, `GC_MakeArcOfCircle2d` (oblouk vždy proti směru, `ccw: false` se otočí), `GC_MakeCircle2d`, `Geom2d_BSplineCurve` (uzly přes `compressKnots` z `face.ts`). Tolerance `tol = 1e-7 · max(1, největší |souřadnice|)` pro uzly i průsečíky.
- **Křížení:** `Geom2dAPI_InterCurveCurve(c1, c2, tol)` jen pro dvojice s překrytými obálkami (řazení podle x); `NbSegments() > 0` (překryv) nebo bod průsečíku dál než `1e3 · tol` od sdíleného uzlu → `crossing`. Spline proti sobě `Geom2dAPI_InterCurveCurve(c, tol)`; u uzavřeného splinu bod v jeho uzlu jen tehdy, když jím křivka prochází i uvnitř (promítnutí uzlu). Průsečíky nevrací parametry, rozhoduje poloha bodu.
- **Stěny:** polohrany s úhlem tečny a znaménkovou křivostí z `D1`/`D2` (zápis do předem vytvořených `gp_Pnt2d`/`gp_Vec2d`, bez alokace v cyklu), `next(e)` jako fake. Znaménková plocha cyklu = součet Greenových integrálů ∮(x dy − y dx)/2 hran (5bodový Gauss–Legendre nad `D1`, spline po úsecích mezi uzly, oblouk 16 kusů na otáčku); ne `BRepGProp` nad plochou z `MakeFace`, který u sevřené smyčky dává jiný obsah. Osamocená kružnice πr².
- **Díry:** bod vnější hranice v kandidátní stěně: obálka, pak parita průsečíků paprsku (`Geom2d_Line` + `InterCurveCurve`). Paprsek pod iracionálním úhlem; když projde uzlem nebo se křivky jen dotkne (sin úhlu ≤ 1e-3), další směr posunutý o zlatý úhel, nejvýš 8 pokusů.
- **Výstup:** smyčky ze **vstupních** křivek (souřadnice beze změny), zpětná polohrana = úsečka s prohozenými konci, oblouk `ccw: false`, spline s obrácenými póly a uzly `a + b − k`. Oblasti podle `name`, výsledek zmrazený. Mřížka 840 úseček ~50 ms, 1860 ~110 ms (TS fake ~390 ms).
- Pro [[Q093 Oblasti z křížících se křivek|Q093]] (oblasti z křížících se křivek) je kandidát `BRepAlgoAPI_Splitter`: křivky v průsečících rozdělí sám a jména kusů dá historie.

### Tažení v adaptéru (M13)

- Typ profilu: `shape.ShapeType()` musí být `TopAbs_FACE`, jinak `'invalid-input'` (kontrola před stavbou).
- **Hranol:** `BRepPrimAPI_MakePrism(face, gp_Vec(d̂ · distance), false, true)` (bez kopie, kanonizace ploch). `IsDone()`, výsledek obsahuje solid (`TopExp_Explorer(…, TopAbs_SOLID).More()`) a `BRepCheck_Analyzer(výsledek).IsValid()`, jinak `'operation-failed'`.
- **Rotace:** `gp_Ax1(gp_Pnt(origin), gp_Dir(direction))`, `BRepPrimAPI_MakeRevol(face, ax1, angle, false)`; stejné kontroly jako u hranolu.
- `FirstShape()`/`LastShape()` (start a konec) a `Generated(hrana)` (boční plochy) algoritmus umí; využije je M14 pro `roles` a historii. Všechny objekty OCCT přes `using`.

### Historie, role a topologie v adaptéru (M14)

- **Historie** jedním pomocníkem `collectHistory(maker, inputs: ShapeEntry[], output: ShapeEntry)` pro každý algoritmus s `Modified/Generated/IsDeleted` (`BRepBuilderAPI_MakeShape`, `BRepAlgoAPI_BuilderAlgo`, `BRepFilletAPI_*`): pro každou plochu `f` každého vstupu `IsDeleted(f)` → `deleted`; jinak `Modified(f)` → indexy ploch výstupu přes `IsSame`; prázdný seznam a `f` je ve výstupu (`IsSame`) → identita; prázdný a ve výstupu není → `deleted`. `Generated(s)` pro plochy, hrany a vrcholy vstupu → jen podtvary typu plocha, které ve výstupu jsou. Prvky seznamů (`NCollection_List_TopoDS_Shape`) a obaly z nich adaptér maže. Cena O(F_vstup · F_výstup) volání `IsSame`; zrychlení přes hash tvaru (v buildu je jako statické `ReplicadShapeHasher.HashCode(tvar, horníMez)`, ne na `TopTools_ShapeMapHasher`) až bude potřeba.
- Boolean: `SetToFillHistory(true)` je výchozí; `Modified` cílových i nástrojových ploch. Transformace: `BRepBuilderAPI_Transform` (`Modified` vrátí přemístěnou plochu).
- **Role kvádru** z `BRepPrimAPI_MakeBox` přes tabulku: `TopFace` → `face:top`, `BottomFace` → `face:bottom`, `LeftFace` (YMin) → `face:front`, `RightFace` (YMax) → `face:back`, `BackFace` (XMin) → `face:left`, `FrontFace` (XMax) → `face:right`; index přes `IsSame` v mapě ploch. **Válec:** `Face()` z `BRepPrimAPI_MakeOneAxis` → `face:side`; ze dvou rovinných ploch je `face:bottom` ta, jejíž bod roviny má menší průmět na osu.
- **`makeFace`:** hrany se staví s id křivky; `BRepBuilderAPI_MakeWire` při slučování vrcholů hrany **kopíruje**, proto se k id ukládá hrana z `MakeWire.Edge()` po každém `Add` (ne postavená hrana); po `ShapeFix_Face` se každá hrana výsledku přiřadí přes `IsSame` k těmto hranám ([[Rozhodnutí noční rychloakce#M14 – Topologické pojmenování|R119]]). `ShapeEntry` dostane `edgeRoles: ReadonlyMap<number, string>` (index hrany → id); `transform` ji přenese přes `Modified` hran (pořadí mapy podtvarů se tuhým pohybem nemění).
- **Hranol a rotace:** `FirstShape()`/`LastShape()` → `face:start`/`face:end`, jen když je `IsSame` ve výsledku; `Generated(hrana profilu)` → `face:side:<id>` pro hrany s rolí; historie přes `collectHistory` (vstup 0 = profil). Rotace o 2π vrací pro hranu kolmou na osu prázdné `Generated` a mezikruží nemá šev: boční plocha se pak hledá náhradně mezi plochami, které nemá žádná jiná role, jako plocha ohraničená všemi kružnicemi z `Generated(vrchol hrany)` ([[Rozhodnutí noční rychloakce#M14 – Topologické pojmenování|R118]] ⚠); historie zůstává přesně podle OCCT. Hrana profilu ležící na ose plochu nevytvoří, takže role nemá.
- **Topologie:** typ plochy `BRepAdaptor_Surface(face).GetType()` (`GeomAbs_Plane` → `'plane'`, `Cylinder`, `Cone`, `Sphere`, `Torus`, jinak `'other'`); rovina z `Plane()` (`Location`, `Axis().Direction()`); normála plochy je `XDir × YDir` rámce, tedy u levotočivého rámce (`gp_Pln.Direct()` = false) opačná než `Axis()` (R119), a u plochy s orientací `TopAbs_REVERSED` ještě obrácená; sousednost hrana → plochy přes `TopExp_Explorer(plocha, TopAbs_EDGE)` a `IsSame` v mapě hran; vrcholy hrany přes `TopExp_Explorer(hrana, TopAbs_VERTEX)`; střed `BRepAdaptor_Curve` v `(First + Last) / 2`. Topologie obsahuje i degenerované hrany (vrchol kužele, pól koule), které síť nemá, takže počet hran topologie se může lišit od počtu hran v `edgeRanges`; indexy sdílí. `TopTools_IndexedDataMapOfShapeListOfShape` (`TopExp::MapShapesAndAncestors`) build nemá, proto výpočet přes explorer, O(F · E).
- **Zaoblení a zkosení:** `BRepFilletAPI_MakeFillet(shape)`, `Add(radius, TopoDS.Edge(hrana))` pro každou hranu, `Build()`; `BRepFilletAPI_MakeChamfer(shape)`, `Add(distance, hrana)`. Po každém `Add` se ověří `maker.Contour(hrana) !== 0`. `Add` je `void` a hranu, kterou OCCT nezpracuje (např. šev válce), jinak tiše vynechá. Taková hrana → `'operation-failed'` se zprávou `fillet: OCCT did not accept edge <i>` (resp. `chamfer: …`), dřív se zaoblily jen ostatní hrany a hlásil se úspěch ([[M19.1-opravy-z-revize|M19.1]]). Výjimka OCCT z `Build`/`Shape`, `!IsDone()`, výsledek bez solidu nebo neplatný (`BRepCheck_Analyzer`) → `'operation-failed'` se zprávou; jiné výjimky (trap WASM, chyba programu) proletí beze změny (trap zůstává fatální, [[Q055 Pád WASM jádra|Q055]]). Historie přes `collectHistory`. Všechny objekty OCCT přes `using`.
- Protokol workeru a klient přeposílají `topology`, `fillet` a `chamfer` jako ostatní metody.

### Export STEP v adaptéru (M15)

- Tvar k zápisu: jeden handle přímo jeho tvar, víc → `TopoDS_Compound` (`TopoDS_Builder.MakeCompound`, `Add` pro každý tvar v pořadí `shapes`). Předpřipravený build váže `TopoDS_Builder`, ne jeho podtřídu `BRep_Builder`; `MakeCompound` a `Add` jsou metody `TopoDS_Builder` (M15).
- `STEPControl_Writer`: `Transfer(tvar, STEPControl_AsIs, true, new Message_ProgressRange())` a `Write(cesta)`; status jiný než `IFSelect_RetDone` → `'operation-failed'`; výjimka OCCT z `Transfer`/`Write` také → `'operation-failed'` (se zprávou výjimky), past WASM projde beze změny (fatální, [[Q055 Pád WASM jádra|Q055]]). Jednotky výchozí (`write.step.unit` = mm, souhlasí s [[01-architektura#Souřadnice a jednotky]]); soubor v mm a schéma AP214 ověřené testem v M15.
- Writer umí psát jen do souboru, proto přes virtuální souborový systém Emscriptenu (`oc.FS`, paměťový MEMFS): cesta `/tmp/tinycad-export-<n>.step` s rostoucím čítačem instance, `oc.FS.readFile(cesta)` → kopie do nového `Uint8Array` (vlastní buffer), `oc.FS.unlink(cesta)` ve `finally` – soubor nezůstane ani po chybě. Objekty OCCT přes `using`.
- Worker vrací bajty přes `transfer` (jako síť), klient je jen předá.

### Volba WASM buildu OCCT (spike v M7)

Rozhodnuto ([[Q012 Volba WASM buildu OCCT|Q012]], [[0013-replicad-opencascadejs|ADR 0013]]): **`replicad-opencascadejs` 1.1.0**. Měření ze spiku (`spikes/m07-occt/`) jsou v ADR.

| Varianta | Pro | Proti |
|---|---|---|
| `opencascade.js` (předpřipravený build) | celé API z JS včetně map | od 2023 stojí, 50 MB WASM, start ~2,4 s, výjimky jako holé ukazatele, přípony přetížení `_1`, `_2` |
| **`replicad-opencascadejs`** (zúžený build z projektu replicad) – zvoleno | 23 MB WASM, start ~100 ms, udržovaný, `Symbol.dispose`, čitelné výjimky | jen podmnožina API, chybí mapy podtvarů |
| Vlastní C++ modul přes Emscripten + embind | úzké API přesně podle `GeometryKernel`, logika v C++, které Pavel zná; malý soubor | nutnost sestavit OCCT pro Emscripten, složitější build |

Port drží API úzké, aby šlo později přejít na vlastní C++ modul beze změny zbytku aplikace. Přechod je samostatný milník [[M16-vlastni-occt-build]].

## `FakeKernel`

```ts
// kernel/testing.ts – jen pro testy (testing.ts se nedostane do produkčního bundlu)
export interface FakeKernel extends GeometryKernel {
  /** Další volání metody `op` selže s `code` (bez vedlejších účinků). Více volání failNext se řadí do fronty. */
  failNext(op: KernelOp, code: KernelErrorCode, message?: string): void;
  /** Počet volání metody (včetně selhaných), nebo všech metod. Pro testy „regenerace nevolá jádro“. */
  callCount(op?: KernelOp): number;
}
export type KernelOp = keyof GeometryKernel;
export function createFakeKernel(): FakeKernel;

/** Kontraktová sada; factory vytvoří pro každý test čerstvé jádro. */
export function describeGeometryKernelContract(name: string, factory: () => Promise<GeometryKernel>): void;
```

- Žije v `kernel/testing.ts`, aby ho mohly používat testy modulů, které na `kernel` závisí hodnotově (`regen`, `features/*`). `render` má z `kernel` jen typy, testuje proti vlastnímu stubu `MeshOps`. Do produkčního kódu se fake nedostane.
- Záznam tvaru (`AabbEntry`) je AABB. `makeBox` uloží `[origin, origin + size]`. Od M11: `makeCylinder` uloží AABB válce pro libovolnou osu (`â` jednotková osa, v ose `k` rozšíření `radius · sqrt(1 − â_k²)` kolem obou podstav); `transform` AABB osmi rohů vstupního AABB po `mat4.transformPoint`; `boolean('union')` obalový AABB všech vstupů, `'subtract'` obalový AABB cílů (jeden cíl beze změny – fake nic neodečítá), `'intersect'` průnik obalu cílů s obalem nástrojů, prázdný nebo nulové tloušťky → `'operation-failed'`. Od M12 `makeFace` uloží AABB smyčky `outer` v prostoru: koncové body křivek a u oblouků a kružnic body v lokálních úhlech 0, π/2, π, 3π/2, které na křivce leží, převedené `plane.toWorld` (přesné pro roviny s osami rovnoběžnými se souřadnicovými, jinde podhodnocené – fake to nevadí); `tessellate` plochy je kvádr s nulovou tloušťkou. Validace vstupů je stejná jako u OCCT.
- Od M13 si záznam pamatuje příznak „plocha“ (`makeFace` ano, `transform` ho dědí, ostatní operace ne) pro kontrolu profilu v `extrude`/`revolve`. `extrude` uloží obálku AABB profilu a AABB posunutého o `d̂ · distance`; `revolve` obálku osmi rohů AABB profilu otočených kolem osy o úhly `0`, `angle` a každé `k · π/2` mezi nimi (přesné pro případy kontraktové sady, jinde přibližné – fake to nevadí).
- Od M14: `topology` každého záznamu je topologie kvádru AABB – 6 rovinných ploch v pořadí sítě (−X, +X, −Y, +Y, −Z, +Z, rovina se středem stěny a normálou ven), 12 hran v pořadí sítě se sousedností a vrcholy odvozenými z rohů, 8 vrcholů, střed hrany = střed úsečky. Role: `makeBox` → `left 0, right 1, front 2, back 3, bottom 4, top 5`; `makeCylinder` → `bottom`/`top` = stěna ve směru −/+ převládající složky osy, `side` = zbylé 4; `extrude` → `start`/`end` = stěna ve směru −/+ převládající složky `d̂` (boční role fake nevrací); `makeFace` a `revolve` role nevrací. Historie: `transform`, `fillet`, `chamfer` identita 6 ploch; `boolean` identita prvního vstupu, ostatní vstupy `deleted`; `extrude`/`revolve` profil `deleted`. `fillet`/`chamfer` vrací AABB beze změny (nový handle) a kontrolují vstup jako OCCT (rozsah hran = 12).
- Od M15: `exportStep` kontroluje vstup jako OCCT a vrací deterministický pseudo-STEP (bajty ASCII kódované ručně `charCodeAt`, protože doménový tsconfig bez DOM a typů Node `TextEncoder` nezná – stejné bajty jako `TextEncoder` pro ASCII): `ISO-10303-21;`, `HEADER;` … `ENDSEC;`, `DATA;`, řádek `#<i>=FAKE_SOLID((min),(max));` na každý tvar v pořadí `shapes` (AABB), `ENDSEC;`, `END-ISO-10303-21;`. Testy vyšších vrstev tak ověří, co se exportovalo.
- Od M29 `makeFace` se splinem: AABB z bodů `bspline.tessellate` (`core`) s tolerancí `1e-7 · max(1, největší |souřadnice|)`; validace jako u OCCT.
- Od M30 `profileRegions` počítá oblasti původním algoritmem skicáře z M12–M29 v TypeScriptu (planární graf, polohrany, tessellace splinu s `1e-4 · max(1, |souřadnice|)`), přesunutým ze `sketch/regions.ts` do `kernel/fake-regions.ts`. Fake je tak skutečný výpočet, ne aproximace: vyšší vrstvy testují oblasti bez OCCT a kontraktová sada drží obě implementace ve shodě.
- `tessellate` vrací AABB jako kvádr: 6 ploch po 2 trojúhelnících (24 vrcholů, normály ploch), pořadí ploch −X, +X, −Y, +Y, −Z, +Z. Dál 12 hran po 2 bodech. Platí pro každý tvar, i válec a výsledek booleanu.
- Volání `failNext` se týká jen dalšího volání dané metody. Injektovaná chyba nevytvoří handle a nic neuvolní.
- Výsledky se vrací asynchronně (v mikroúloze), nikdy synchronně, aby testy vyšších vrstev nespoléhaly na pořadí, které by s workerem neplatilo.

## Testy

- **Kontraktová sada** `describeGeometryKernelContract` v `kernel/testing.ts`, spuštěná pro `FakeKernel` (M5) a pro `OcctKernelImpl` přímo v Node (M7, `src/kernel-occt/*.test.ts` v projektu `unit`, tedy v `npm run check`; modul OCCT se načte jednou na soubor, [[Q051 Kde běží kontraktové testy OCCT|Q051]]). Pokrývá každou odrážku [[06-geometricke-jadro#Kontrakt (platí pro každou implementaci)|kontraktu]]:
  - nové handle po každé operaci, nikdy znovu použité,
  - všechny kódy chyb, odmítnutí místo synchronní výjimky, atomicitu `release`, `liveHandleCount`,
  - **kvádr:** bounding box, síť projde `validateMeshData`, právě 6 ploch s indexy 0–5 a 12 hran s indexy 0–11, každá plocha má aspoň 2 trojúhelníky, body leží v AABB a pokrývají ho, normály trojúhelníků jedné plochy jsou shodné, kolmé ke stěně (rovnoběžné se souřadnicovou osou), míří **ven** a šest ploch leží na šesti různých stěnách (navinutí trojúhelníku souhlasí s normálou),
  - nové buffery při každém `tessellate`,
  - **M11** (bbox s tolerancí 1e-5, nic, co platí jen pro jedno jádro): `makeCylinder` pro osy X, Y a nejednotkovou Z a každý neplatný vstup; `transform` posun, rotace o 90° a 45° kolem Z, vstup zůstává platný, nerigidní matice (zrcadlení, měřítko, zkosení, `NaN`) → `'invalid-input'`; `boolean` – `union` překrývajících se i oddělených kvádrů (obalový bbox), `intersect` překrývajících se (přesný průnik) a oddělených (`'operation-failed'`, žádný handle), `subtract` s nástrojem, který odřízne roh (bbox cíle), neplatné seznamy a `op`; síť každého výsledku projde `validateMeshData` a leží v bbox; izolace vstupů.
- **M12** (kontraktová sada): `makeFace` – čtverec v rovině XY, obdélník v rovině XZ posunuté do `origin [0, 5, 0]`, kružnice v rovině YZ, smyčka z úsečky a půlkruhového oblouku („D“, `ccw` true i false), čtverec s kruhovou dírou: bbox s tolerancí 1e-5, síť projde `validateMeshData`; neortonormální rovina, neuzavřená smyčka, kružnice uprostřed víceprvkové smyčky, nulová úsečka, oblouk s nestejným poloměrem, prázdná `outer` → `'invalid-input'` bez handle; izolace vstupu.
- **M13** (kontraktová sada): `extrude` – čtverec 10 × 10 na XY o 5 ve směru +Z, o 5 ve směru `[0, 0, 3]` (nejednotkový), ve směru −Z, obdélník na XZ ve směru −Y: bbox s tolerancí 1e-5, síť projde `validateMeshData` a leží v bbox; profil zůstává platný; profil po `transform` (posunutý čtverec) funguje; `distance` 0, záporná, `NaN`, nulový směr, profil kvádr → `'invalid-input'` bez handle; neznámý handle; izolace vstupu. `revolve` – obdélník na XZ (`x ∈ [5, 10]`, `z ∈ [0, 10]`) kolem osy Z o 2π → bbox `[−10, 10]² × [0, 10]`, o π/2 → `[0, 10]² × [0, 10]`, o π/2 kolem osy s opačným směrem → `x ∈ [0, 10]`, `y ∈ [−10, 0]`; úhel 0, záporný, > 2π, `NaN`, nulový směr osy, profil kvádr → `'invalid-input'`; síť projde `validateMeshData`.
- **M14** (kontraktová sada): `topology` kvádru (6 rovinných ploch s normálami ven, 12 hran, každá se dvěma plochami a dvěma vrcholy, 8 vrcholů; počty sedí se sítí; `unknown-handle`); role kvádru (6 klíčů, každý jedna plocha, různé, normála plochy role odpovídá ose podle tabulky) a válce (`top`/`bottom` po jedné rovinné ploše s normálou ±osa, `side` neprázdné, disjunktní); úplnost historie u `transform`, `boolean` (všechny tři operace), `extrude`, `revolve`, `fillet`, `chamfer` (každá plocha vstupu právě jednou v `modified` nebo `deleted`, indexy v rozsahu); `fillet`/`chamfer` jedné hrany kvádru – bbox beze změny, vstup platný, neplatné vstupy (`[]`, duplicita, index mimo rozsah, neceločíselný, poloměr 0, záporný, `NaN`) → `'invalid-input'` bez handle; izolace vstupu `edges`.
- **M15** (kontraktová sada): `exportStep` kvádru a dvou kvádrů – začátek a konec textu, neprázdný; `[]` a duplicitní handle → `'invalid-input'`; neznámý a uvolněný handle → `'unknown-handle'`; vstup zůstává platný a `liveHandleCount` se nemění; dvě volání vrací různé buffery.
- `kernel-occt` navíc (M15, akceptace): kvádr 20 × 20 × 10 minus válec r = 3 přes celou výšku → bajty zpět do `oc.FS` → `STEPControl_Reader` (`ReadFile` = `IFSelect_RetDone`, `TransferRoots`, `OneShape`) má právě jeden solid s objemem `4000 − 90π` (`BRepGProp.VolumeProperties`, relativně 1e-4) a stejným bounding boxem (1e-5); dva oddělené kvádry → dva solidy a součet objemů; dočasný soubor po exportu v `oc.FS` není.
- `kernel-occt` navíc (M14): kvádr minus procházející válec – plocha pláště válce je v `modified` z nástroje, horní a spodní stěna kvádru z cíle, podstavy válce `deleted`, topologie 7 ploch a hrana mezi horní stěnou a pláštěm; zaoblení hrany kvádru – 7 ploch, právě jedna `generated` z dané hrany, dvě sousední stěny `modified`; zkosení – 7 ploch, nová rovinná; zaoblení i zkosení velikosti 11 u kvádru 10 → `'operation-failed'` (plán počítal s poloměrem 6, ten v testu neselhal); `makeFace` obdélníku s id čtyř úseček – 4 role `edge:<id>` na různé hrany, po `transform` a `extrude` 4 role `face:side:<id>` + `start` + `end` (6 ploch); rotace o 2π bez `start`/`end`, o π/2 s nimi; kružnice s id → jedna boční plocha; válec `bottom` v `base`.
- `kernel-occt` navíc (M13): hranol čtverce 10 × 10 × 5 má 6 ploch a objem 500 (1 %); hranol čtverce s kruhovou dírou r = 2 má 7 ploch a objem `(100 − 4π) · 5`; rotace obdélníku (`x ∈ [5, 10]`) o 2π má 4 plochy a objem `750π`, o π/2 6 ploch a čtvrtinu objemu; rotace obdélníku `x ∈ [0, 5]` (osa na hraně) o 2π má objem `250π`.
- `kernel-occt` navíc (M12): plocha má v síti 1 plochu; obsah (`BRepGProp.SurfaceProperties`) čtverce s dírou = `a² − πr²` (relativně 1e-6), „D“ = obdélník + půlkruh; samoprotínající se smyčka (motýlek) → `'operation-failed'`.
- `validateMeshData`: platná síť, každé pravidlo porušené zvlášť.
- `kernelErrorCode`: vlastní chyba, `RpcError` se stejným kódem, cizí kód a ne-chyba → `undefined`.
- `FakeKernel` navíc: `failNext` (jednorázové, fronta, bez vedlejších účinků), `callCount`.
- `isRigidMotion`: identita, rotace s posunem → `true`; zrcadlení, měřítko, zkosení, neafinní spodní řádek, `NaN` → `false`.
- `kernel-occt` navíc (M11, mimo kontrakt): válec má 3 plochy a objem ze sítě do 1 % od `πr²h`; posunutý a otočený kvádr 6 ploch a stejný objem; kvádr minus válec, který jím prochází, 7 ploch a objem do 1 %; `subtract`, kde nástroj cíl celý pokryje → `'operation-failed'`; `union` oddělených kvádrů 12 ploch.
- `kernel-occt` navíc (M7):
  - mapy podtvarů: kvádr má 6 / 12 / 8 ploch, hran a vrcholů, pořadí ploch −X, +X, −Y, +Y, −Z, +Z (pořadí `MapShapes` pro `MakeBox`),
  - `boundingBox` kvádru přesně (bez tolerance tvaru),
  - výjimka OCCT uvnitř metody → odmítnutí s kódem `'internal'` a typem výjimky ve zprávě,
  - paměť se automaticky netestuje: samo OCCT po `delete()` nechá ~11 kB na kvádr, takže únik v adaptéru nejde od úniku buildu odlišit ([[Q054 Únik paměti v OCCT buildu|Q054]]). Že adaptér uvolní všechny objekty OCCT, které vlastní (`using`, `ShapeEntry` při `release`), ověřuje revize. Paměťový test patří do [[M16-vlastni-occt-build]],
  - klient přes `MessageChannel` v Node: `ready`, předání sítě přes `transfer`, chyba jádra dorazí s kódem, `failAll` odmítne čekající volání.
