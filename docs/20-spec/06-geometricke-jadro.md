---
type: spec
status: implemented
order: 6
aliases:
  - kernel – geometrické jádro
  - Spec 06
modules:
  - kernel
  - kernel-occt
milestones:
  - "[[M05-kernel-port]]"
  - "[[M07-kernel-occt]]"
  - "[[M11-dalsi-entity]]"
  - "[[M16-vlastni-occt-build]]"
tags:
  - spec
created: 2026-10-12
updated: 2026-10-14
---
# 06 – `kernel` a `kernel-occt`: geometrické jádro

> **Pojmy:** [[Geometrické jádro]], [[Handle tvaru]], [[Port a adaptér]]  
> **Rozhodnutí:** [[0002-occt-wasm-ve-workeru]], [[0011-programovani-proti-rozhranim]], [[Q039 Chyby jádra přes hranici workeru|Q039]]  
> **Milník:** [[M05-kernel-port]], [[M07-kernel-occt]], [[M11-dalsi-entity]]

Geometrické jádro je za **portem** `GeometryKernel`. Doména (`regen`) zná jen rozhraní. Konkrétní implementace:

- **OCCT** (`kernel-occt`): OpenCascade ve WASM, běží ve Web Workeru ([[0002-occt-wasm-ve-workeru|ADR 0002]]). Tovární funkce `createOcctKernel(): Promise<GeometryKernel & Disposable>` (počká na start workeru) – M7.
- **Fake** (`kernel`): jednoduchá implementace v paměti pro testy vyšších vrstev, každý tvar drží jen jako AABB (od M11 i válec, transformace a boolean, [[#`FakeKernel`]]). `createFakeKernel(): FakeKernel` z `kernel/testing.ts` – M5.

Třídy jsou skryté v modulech, ven jdou rozhraní a tovární funkce ([[0011-programovani-proti-rozhranim|ADR 0011]]). Ven nejde ani třída chyby ([[#Chyby]]).

`kernel` je prstenec 1 a importuje jen `core`.

## Handle místo tvarů

`TopoDS_Shape` žije ve workeru a nikdy neopouští jeho paměť. Ven jde jen neprůhledné číslo, [[Handle tvaru|handle]]:

```ts
export type ShapeHandle = Brand<number, 'ShapeHandle'>;
```

- Každá operace vrací **nový** handle. Vstupní handle se nemění (neměnnost jako v doméně).
- Handle je kladné celé číslo a **v rámci jedné instance jádra se nikdy nepoužije znovu** (rostoucí čítač). Uvolněný handle proto spolehlivě skončí chybou `'unknown-handle'`, nikdy nezamění tvar. Na tom stojí souběh `render` a mark & sweep v [[07-regenerace#Životnost handle: mark & sweep|regeneraci]].
- Handle se musí uvolnit (`release`). O životnost se stará `regen` (mark & sweep).
- Handle platí jen v rámci jedné instance jádra. Neukládají se a dokument na ně neodkazuje. Handle z jiné instance jádra rozpoznat nejde (je to jen číslo). Aplikace má jedno jádro.

## Datové struktury na obou stranách

Port přenáší jen **identitu** (handle) a **hodnoty** (síť, bounding box, indexy podtvarů, historie). Obaly kolem tvarů žijí na obou stranách hranice a každý drží něco jiného:

```
hlavní vlákno (doména)                         worker (adaptér, M7)
┌────────────────────────────┐                ┌──────────────────────────────────┐
│ regen: Body                │   ShapeHandle  │ kernel-occt: ShapeEntry          │
│  id: BodyId (stabilní)     │ ─────────────► │  shape: TopoDS_Shape             │
│  shape: ShapeHandle        │   (jen číslo)  │  faces/edges/vertices:           │
│  origin: FeatureId         │                │    TopTools_IndexedMapOfShape    │
│  names: topologická jména  │ ◄───────────── │  mesh?: cache tessellace         │
└────────────────────────────┘  MeshData,     │  history/roles z algoritmu       │
       „co tvar znamená“         bbox… (data) └──────────────────────────────────┘
                                                „co OCCT má a jak to najít“
```

- **`ShapeEntry` (adaptér):** handle je klíč do soukromé `Map<ShapeHandle, ShapeEntry>`. Záznam drží tvar a **mapy podtvarů** spočítané jednou při vzniku tvaru (algoritmem `TopExp::MapShapes`, [[#`kernel-occt`: architektura adaptéru|viz adaptér]]). Díky nim je `SubShapeIndex` pro daný handle stabilní napříč dotazy (síť, topologie, historie). Cache sítě, role a historie přibudou, až je bude potřeba (M11, M14); v M7 záznam drží jen tvar a mapy. Je soukromý v adaptéru. `FakeKernel` má vlastní záznam `{ min, max }` (AABB).
- **`Body` (doména, [[07-regenerace|spec 07]]):** stabilní `BodyId` napříč regeneracemi (handle se mění při každé), rodokmen (`origin`, `lastModifiedBy`, [[0015-artefakty-a-identita-telesa|ADR 0015]]) a od M14 topologická jména. UI, výběr i reference featur odkazují na `Body` a jména, nikdy na handle.
- Na hlavním vlákně **nejsou** objekty obalující tvar (proxy s metodami `shape.mesh()`). Neměly by vlastní data a míchaly by „co tvar znamená“ (`Body`) s „co spočítalo jádro“ (`ShapeEntry`).

## Rozhraní (segregované)

Rozhraní je rozdělené podle schopností (interface segregation). Builder featury si vezme jen to, co potřebuje. Rozhraní **roste s milníky**, nic se nepřidává do zásoby.

### Stav po M5

```ts
export interface BoundingBox { readonly min: Vec3; readonly max: Vec3 }
export interface MeshQuality { readonly linearDeflection: number; readonly angularDeflection: number }

export interface PrimitiveOps {
  /** Kvádr od rohu origin ve směru +x, +y, +z. AABB = [origin, origin + size]. */
  makeBox(p: { readonly origin: Vec3; readonly size: Vec3 }): Promise<ShapeResult>;
}

export interface MeshOps {
  tessellate(shape: ShapeHandle, q: MeshQuality): Promise<MeshData>;
}

export interface QueryOps {
  boundingBox(shape: ShapeHandle): Promise<BoundingBox>;
}

export interface LifecycleOps {
  release(handles: readonly ShapeHandle[]): Promise<void>;
  /** Počet neuvolněných handle; pro testy úniků (mark & sweep). */
  liveHandleCount(): Promise<number>;
}

export interface GeometryKernel extends PrimitiveOps, MeshOps, QueryOps, LifecycleOps {}
```

### Stav po M11

M11 přidal válec, tuhou transformaci a boolean ([[M11-dalsi-entity|M11]], Ú1):

```ts
export interface PrimitiveOps {
  makeBox(p: { readonly origin: Vec3; readonly size: Vec3 }): Promise<ShapeResult>;
  /** Válec: podstava se středem base, osa ve směru axis (nemusí být jednotková), výška height podél osy. */
  makeCylinder(p: { readonly base: Vec3; readonly axis: Vec3; readonly radius: number; readonly height: number }): Promise<ShapeResult>;
}

export interface TransformOps {
  /** Nový tvar = shape přemístěný tuhou transformací m (rotace + posun, bez zrcadlení a měřítka). */
  transform(shape: ShapeHandle, m: Mat4): Promise<ShapeResult>;
}

export type BooleanOp = 'union' | 'subtract' | 'intersect';
export interface BooleanOps {
  /** Jeden výsledný tvar (případně compound více solidů); vstupy zůstávají platné. */
  boolean(op: BooleanOp, targets: readonly ShapeHandle[], tools: readonly ShapeHandle[]): Promise<ShapeResult>;
}

export interface GeometryKernel extends PrimitiveOps, TransformOps, BooleanOps, MeshOps, QueryOps, LifecycleOps {}

/** m je tuhý pohyb: konečná čísla, spodní řádek [0,0,0,1], rotační část ortonormální s det +1 (tolerance po prvcích, výchozí 1e-9). */
export function isRigidMotion(m: Mat4, tolerance?: number): boolean;
```

`transform` přijímá jen tuhé pohyby ([[Rozhodnutí noční rychloakce#M11 – Další entity|R7]]): `gp_Trsf` v OCCT zrcadlení a měřítko sice umí, ale zrcadlení otočí navinutí trojúhelníků a měřítko mění geometrii (kopie místo lokace). Featura Transform v M11 nic jiného nepotřebuje. `isRigidMotion` je jedna kontrola pro obě implementace.

Výsledek booleanu je v M11 **vždy jeden handle** (u více cílů nebo nesouvislého výsledku compound více solidů). Rozpad na více těles podle historie jádra přijde s historií v [[M14-topologicke-pojmenovani|M14]] ([[Rozhodnutí noční rychloakce#M11 – Další entity|R8]]).

### Plánované rozšíření

Přidávají se do `GeometryKernel` v milníku, který je potřebuje, a kontraktová sada se o ně rozšíří:

```ts
export interface SweepOps {          // M13
  extrude(profile: ProfileInput, direction: Vec3, distance: number): Promise<ShapeResult>;
  revolve(profile: ProfileInput, axis: Axis, angle: number): Promise<ShapeResult>;
}
export interface DressupOps {        // M14
  fillet(shape: ShapeHandle, edges: readonly number[], radius: number): Promise<ShapeResult>;
  chamfer(shape: ShapeHandle, edges: readonly number[], distance: number): Promise<ShapeResult>;
}
// QueryOps (M14): počty a typy ploch a hran, pro naming a ladění
topology(shape: ShapeHandle): Promise<TopologySummary>;
export interface ExchangeOps {       // M15
  exportStep(shapes: readonly ShapeHandle[]): Promise<Uint8Array>;
}
```

### Kontrakt (platí pro každou implementaci)

Ověřuje ho kontraktová sada ([[#Testy]]), spuštěná pro `FakeKernel` v M5 a pro OCCT v M7.

- **Asynchronní a bez synchronních výjimek:** každá metoda vrací `Promise`. Chyba je vždy odmítnutý `Promise`, nikdy výjimka při volání.
- **`makeBox`:** každá složka `origin` je konečné číslo, každá složka `size` je konečné číslo > 0, jinak `'invalid-input'`. Vrací nový handle. Bounding box výsledku **obaluje** `[origin, origin + size]`: `min ≤ origin`, `max ≥ origin + size`, nadsazení nejvýš 1e-6 v každé složce. OCCT `BRepBndLib::Add` rozšiřuje box o toleranci tvaru (~1e-7), adaptér proto použije `BRepBndLib::AddOptimal` bez tolerance tvaru (M7).
- **`makeCylinder`** (M11): každá složka `base` a `axis` konečná, délka `axis` > 1e-9, `radius` a `height` konečné > 0, jinak `'invalid-input'`. Bounding box výsledku odpovídá válci (podstavy `base` a `base + height·â` s poloměrem `radius`) s tolerancí 1e-5 v každé složce.
- **`transform`** (M11): všech 16 prvků konečných a `isRigidMotion(m)`, jinak `'invalid-input'`; neznámý handle → `'unknown-handle'`. Vstupní tvar se nemění a zůstává platný. Bounding box výsledku = bounding box tvaru přemístěného `m` (tolerance 1e-5).
- **`boolean`** (M11): `op` je jedna ze tří hodnot, `targets` i `tools` neprázdné a žádný handle se neopakuje (ani napříč seznamy), jinak `'invalid-input'`; neznámý handle → `'unknown-handle'`. Výsledek bez jediného solidu (prázdný průnik, rozdíl, který cíl celý odebere) a selhání algoritmu → `'operation-failed'`. Vstupy zůstávají platné. `union` = sjednocení všech vstupů, `subtract` = cíle bez nástrojů, `intersect` = společná část cílů a nástrojů.
- Žádná operace zatím nevyplňuje `history` ani `roles` (M14).
- **`tessellate`:** `linearDeflection` i `angularDeflection` jsou konečná čísla > 0, jinak `'invalid-input'`. Neznámý handle → `'unknown-handle'`. Každé volání vrací **nové** buffery, nesdílené s jiným voláním, s jiným polem téže sítě ani s vnitřním stavem jádra, takže je volající smí přenést jako transferable. Že opakované volání vrátí stejná data, se **nezaručuje** (OCCT může síť zjemnit).
- **`boundingBox`:** neznámý handle → `'unknown-handle'`. Vrací nový objekt.
- **`release`:**
  - Prázdné pole → nic.
  - Neznámý nebo už uvolněný handle → `'unknown-handle'`. Stejný handle dvakrát v jednom volání → `'invalid-input'`.
  - **Atomický:** při chybě se neuvolní nic. Přísnost odhalí chyby v mark & sweep, které by tolerantní `release` skryl.
- **`liveHandleCount`:** počet vytvořených a neuvolněných handle. Neúspěšná operace žádný handle nevytvoří.
- **Více chyb najednou** (např. neznámý handle i neplatná kvalita): který kód se vrátí, není určeno a sada to netestuje. `FakeKernel` dává přednost chybě z `failNext`.
- **Izolace:** jádro si neponechává odkaz na vstupní objekty (`origin`, `size`, `base`, `axis`, matice, pole handle) a **čte je synchronně při volání**, jako by je klonoval `postMessage`. Změna vstupu hned po volání (před `await`) výsledek neovlivní. Vrácená data nesdílí paměť s ničím jiným. Když čtení vstupu selže (vstup mimo typy, např. `null`), je to také odmítnutý `Promise`, ne synchronní výjimka.

### Výsledek operace a historie

Aby šlo stavět topologické pojmenování ([[08-topologicke-pojmenovani|08]]), vrací každá operace kromě tvaru i **historii**: co ze vstupu vzniklo, co se změnilo, co zaniklo. V OCCT to odpovídá `BRepBuilderAPI_MakeShape::Generated / Modified / IsDeleted`.

```ts
export interface ShapeResult {
  readonly shape: ShapeHandle;
  readonly history?: ShapeHistory;   // do M14 se nevyplňuje
  readonly roles?: Readonly<Record<string, readonly SubShapeIndex[]>>; // pojmenované části, např. { 'face:top': [5] }; do M14 se nevyplňuje
}

/** Index podtvaru = pozice v TopExp::MapShapes(shape, TopAbs_FACE/EDGE/VERTEX), od 0 (OCCT počítá od 1, adaptér odečte). */
export interface SubShapeIndex { readonly type: 'face' | 'edge' | 'vertex'; readonly index: number }

export interface ShapeHistory {
  /** Pro každý vstupní tvar: index podtvaru ve vstupu → indexy podtvarů ve výstupu. */
  readonly modified: readonly HistoryLink[];
  readonly generated: readonly HistoryLink[];
  readonly deleted: readonly { readonly input: number; readonly sub: SubShapeIndex }[];
}
export interface HistoryLink { readonly input: number; readonly from: SubShapeIndex; readonly to: readonly SubShapeIndex[] }
```

Typy `ShapeHistory`, `HistoryLink` a `SubShapeIndex` vznikají už v M5, aby měl `ShapeResult` konečný tvar. V M5 je žádná implementace nevyplňuje.

Indexy podtvarů platí jen pro konkrétní handle, napříč regeneracemi stabilní nejsou. Stabilitu zajišťují až jména.

### Síť pro vykreslení

```ts
export interface MeshData {
  // <ArrayBuffer>: pole stojí na obyčejném (přenositelném) ArrayBuffer, ne SharedArrayBuffer.
  readonly positions: Float32Array<ArrayBuffer>;   // xyz
  readonly normals: Float32Array<ArrayBuffer>;     // xyz, jednotkové, jedna na vrchol
  readonly indices: Uint32Array<ArrayBuffer>;      // trojúhelníky, proti směru hodinových ručiček při pohledu zvenku
  /** Rozsahy trojúhelníků podle B-rep plochy, pro picking a zvýraznění plochy. */
  readonly faceRanges: Uint32Array<ArrayBuffer>;   // trojice [faceIndex, firstTriangle, triangleCount] za sebou
  /** Polyline hran: body za sebou, rozsahy podle hrany. */
  readonly edgePositions: Float32Array<ArrayBuffer>;
  readonly edgeRanges: Uint32Array<ArrayBuffer>;   // trojice [edgeIndex, firstPoint, pointCount]
}

/** Strukturální kontrola sítě. Prázdné pole = v pořádku. Pro testy obou jader a vývojovou kontrolu v app (render smí z kernel jen typy). */
export function validateMeshData(mesh: MeshData): readonly string[];
```

Ploché typed arrays, aby šly přes `postMessage` přenést jako transferable bez kopírování. **Každé pole má vlastní `ArrayBuffer`** (a zabírá ho celý). Seznam bufferů k přenosu tak nemá duplicity, se kterými by `postMessage` skončil `DataCloneError`.

`validateMeshData` kontroluje:
- délky: `positions` a `normals` stejně dlouhé a dělitelné 3, `indices` dělitelné 3, `faceRanges` a `edgeRanges` dělitelné 3, `edgePositions` dělitelné 3,
- všechna čísla konečná, normály jednotkové (tolerance 1e-4), každý index vrcholu < počet vrcholů,
- `faceRanges`: trojice **seřazené podle `firstTriangle`** (picking v `render` v nich hledá binárně), žádný rozsah nesahá za konec pole, rozsahy se nepřekrývají a dohromady pokrývají **každý trojúhelník právě jednou**, každý `faceIndex` nejvýš jednou. každý rozsah má **aspoň 1 trojúhelník**. Plochu bez trojúhelníků (OCCT ji vrátí u plochy, kterou nešlo tesselovat) adaptér do `faceRanges` nezapíše: kliknout se na ni nedá a ostré řazení pak platí bez výjimek. Že má kvádr všech 6 ploch, hlídá kontraktová sada,
- `edgeRanges`: trojice seřazené podle `firstPoint`, žádný rozsah nesahá za konec pole, každá hrana má aspoň 2 body, rozsahy pokrývají každý bod `edgePositions` právě jednou, každý `edgeIndex` nejvýš jednou.

### Chyby

Operace jádra selhávají běžně (neplatný boolean, fillet s příliš velkým poloměrem). Chyba je odmítnutý `Promise` s `Error`, který má `code`. Rozpoznává se podle kódu, ne třídou, protože třída přes `postMessage` nepřežije ([[Q039 Chyby jádra přes hranici workeru|Q039]]):

```ts
export type KernelErrorCode = 'invalid-input' | 'operation-failed' | 'unknown-handle' | 'internal';
/** Error s vlastností code. Pro implementace jádra. */
export function createKernelError(code: KernelErrorCode, message: string): Error;
/** Kód chyby jádra, nebo undefined pro jinou chybu. Funguje v paměti i přes RPC (RpcError se stejným code). */
export function kernelErrorCode(e: unknown): KernelErrorCode | undefined;
```

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
- `OcctKernelImpl` drží soukromou `Map` handle → `ShapeEntry` ([[#Datové struktury na obou stranách]]) a veškerou práci s OCCT. Modul OCCT dostane v konstruktoru (nenačítá ho sám), takže jde testovat přímo v Node bez workeru. Všechny OCCT objekty vytvořené v metodě uvolňuje deklarací `using` (embind objekty mají `[Symbol.dispose]`, který volá `.delete()`), `try/finally` jen tam, kde objekt opouští rozsah ([[0013-replicad-opencascadejs|ADR 0013]]).
- Inicializace WASM proběhne jednou při startu workeru (v prohlížeči ~300 ms, v Node ~100 ms), klient vystaví `ready: Promise<void>`.
- Worker zpracovává požadavky sériově. Dlouhé operace (fillet) blokují další, pro začátek je to přijatelné.
- **Mapy podtvarů:** zvolený build nemá svázané `TopExp::MapShapes` ani `TopTools_IndexedMapOfShape`. Jediný pomocník adaptéru je počítá stejným algoritmem: `TopExp_Explorer(shape, typ)` a přidání podtvaru, jen pokud v seznamu ještě není podtvar `IsSame`. Pořadí, a tedy i `SubShapeIndex`, je proto stejné jako u `MapShapes`. Cena je O(n²) volání `IsSame`.
- **Výjimky OCCT** přicházejí jako `WebAssembly.Exception`. Adaptér je přes `getExceptionMessage` převede na chybu `'internal'` se zprávou `<typ OCCT>: <zpráva>`, při prázdné zprávě jen `<typ OCCT>`. `'operation-failed'` z převodu výjimky nevzniká: operace, které běžně selhávají (boolean, fillet – M11+), kontrolují `IsDone()` a tuto chybu vyhodí samy. Pád samotného WASM (`WebAssembly.RuntimeError`: trap, `unreachable`, přetečení zásobníku, nedostatek paměti, „function signature mismatch“) je **fatální** ([[Q055 Pád WASM jádra|Q055]], od M10): worker nejdřív pošle notifikaci `{ type: 'fatal', message }` (bez `id`, RPC klient ji přeskočí) a teprve pak odpoví na volání chybou; klient na notifikaci zavolá `failAll` → všechna čekající volání **včetně toho, které trap vyvolalo**, i další volání skončí `'disconnected'` a worker se ukončí. Požadavky, které ve workeru čekají po trapu, worker k jádru nepustí. `toKernelError` trap nepřevádí na `'internal'`, nechá ho projít. Jádro po trapu už nic nepočítá, protože jeho paměť může být poškozená. Nové jádro vytvoří `app` ([[11-ui]]); `regen` po `'disconnected'` zahodí cache a handle ([[Q049 Pád jádra během regenerace|Q049]]). Vlastní build ([[M16-vlastni-occt-build]]) trapy jen omezí, neodstraní.
- **Vite:** WASM se načítá přes `import wasmUrl from 'replicad-opencascadejs/wasm?url'` a `locateFile: () => wasmUrl`, balík je v `optimizeDeps.exclude`, worker má `format: 'es'`. Import s dotazem `?url` dependency-cruiser nevyřeší (bere `?url` jako část podcesty `exports`), proto ho pravidlo `not-to-unresolvable` vynechává a hlídá ho zvláštní pravidlo `<modul>-allowed-npm-assets` se stejným seznamem npm balíků ([[01-architektura]]). Překlep v takové cestě odhalí až `vite build`. `vite build` hlásí neškodné varování: `node:module` z kódu Emscriptenu pro Node se v prohlížeči nahradí prázdným modulem.
- **`using` v prohlížeči:** Vite 8 deklaraci `using` převádí na pomocnou funkci, která hledá `Symbol.dispose ?? Symbol.for('Symbol.dispose')`. Embind ale metodu `[Symbol.dispose]` přidá jen tehdy, když `Symbol.dispose` existuje. Worker proto **před** inicializací OCCT doplní `Symbol.dispose = Symbol.for('Symbol.dispose')`, **jen pokud chybí** (v TS přes `Object.defineProperty`, vlastnost je deklarovaná jako readonly), aby obě strany použily stejný symbol i v prohlížeči bez nativní podpory.

### Start workeru a `ready`

Modulový worker inicializuje OCCT asynchronně. Zpráva, která do workeru dorazí dřív, než si zaregistruje posluchače, se ztratí. Proto:

1. `occt.worker.ts` zavolá `serveRpc` **hned synchronně** při startu. Implementace drží `Promise<OcctKernelImpl>` a každá metoda nejdřív počká na něj.
2. Protokol `OcctKernelProtocol` = metody `GeometryKernel` + `ready(): void`. `ready` počká na inicializaci. Selhání inicializace (nenalezený WASM…) se tak dostane ke klientovi jako odmítnutí (`'internal'` se zprávou), ne jako neodchycená výjimka ve workeru, kterou `worker.onerror` nezachytí. Implementace selhání inicializace hned označí jako ošetřené (`catch`), aby z něj ve workeru nebylo neošetřené odmítnutí, dokud se nikdo nezeptá; každé další `await` přesto odmítne.
3. `createOcctKernel()` vytvoří worker, napojí `onerror`/`messageerror` na `rpc.failAll`, počká na `ready` a vrátí `GeometryKernel & Disposable`. Když `ready` selže, worker ukončí a odmítne: chyba inicializace OCCT → `'internal'`; worker, který vůbec nenaběhne (404, chyba skriptu) → `onerror` → `'disconnected'`. `dispose()` = `rpc.dispose()` + `worker.terminate()`.
4. Klient výsledek `tessellate` jen předá: buffery přišly přes `transfer`, worker o ně přišel (kontrakt nových bufferů tím platí automaticky).

### Tessellace v adaptéru

- `BRepMesh_IncrementalMesh(shape, linearDeflection, false, angularDeflection, false)`: absolutní průhyb, bez paralelismu (worker je jednovláknový).
- Plochy v pořadí mapy podtvarů (`SubShapeIndex` = pozice). Každá plocha má **vlastní vrcholy** (žádné sdílení mezi plochami), aby šly normály ostrých hran a `faceRanges`. Uzly triangulace se transformují `TopLoc_Location` plochy.
- Plocha s orientací `TopAbs_REVERSED`: prohodí se pořadí dvou vrcholů každého trojúhelníku a otočí normály, aby trojúhelníky byly CCW při pohledu zvenku.
- Normály: z triangulace, pokud je má; jinak průměr jednotkových normál nedegenerovaných trojúhelníků plochy v uzlu (u rovinné plochy vyjde normála plochy), normalizovaný. Navinutí se otáčí **před** výpočtem normál, takže vyjdou ven samy. Uzel bez nedegenerovaného trojúhelníku dostane průměrnou normálu plochy. Plocha, která má jen degenerované trojúhelníky, se vynechá (jako plocha bez trojúhelníků). Zatím se používá jen druhá cesta i pro válec (M11): síť projde `validateMeshData` a objem sedí, na švu pláště mohou být normály lehce vidět; normály z triangulace se doplní, až to bude vadit ([[Rozhodnutí noční rychloakce#M11 – Další entity|R21]]).
- Lokace se aplikují přes `gp_Trsf.Transforms(x, y, z)` (bez nového objektu OCCT na uzel). **Zrcadlící lokace** (`gp_Trsf.IsNegative()`) by otočila navinutí; nevznikne, protože `transform` přijímá jen tuhé pohyby (M11).
- Hrany v pořadí mapy podtvarů. Polyline z `BRep_Tool.PolygonOnTriangulation(edge, loc)`: OCCT vybere první reprezentaci hrany na triangulaci sousední plochy a vrátí polygon, tu triangulaci a složenou lokaci. Uzly polygonu jsou indexy do vrácené triangulace, transformují se vrácenou lokací. Degenerovaná hrana, hrana bez polygonu nebo s méně než 2 body se do `edgeRanges` nezapíše (jako plocha bez trojúhelníků).
- Chybějící triangulaci nebo polygon vrací binding jako JS `null`, i když `.d.ts` slibuje objekt; adaptér na `null` testuje explicitně.
- Výsledek se kopíruje do nových typed arrays, každé s vlastním `ArrayBuffer` ([[#Síť pro vykreslení]]).

### Modelovací operace v adaptéru (M11)

- **Válec:** `BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(base), gp_Dir(axis)), radius, height)`. Má 3 plochy (plášť, dvě podstavy) a 3 hrany (dvě kružnice a šev).
- **Transformace:** `gp_Trsf.SetValues(a11 … a34)` po řádcích (`a_rc = m[c*4 + r]`, `Mat4` je po sloupcích) a `BRepBuilderAPI_Transform(shape, trsf, false)`. Tuhý pohyb jen nastaví lokaci, geometrie (`TShape`) se nekopíruje a sdílí s původním tvarem; tessellace lokaci ploch aplikuje.
- **Boolean:** prázdný konstruktor `BRepAlgoAPI_Fuse | Cut | Common`, `SetArguments(cíle)`, `SetTools(nástroje)` (seznamy `NCollection_List_TopoDS_Shape`; `Append` vrací nový obal `TopoDS_Shape`, který adaptér smaže), `Build()`. `HasErrors()` → `'operation-failed'`; výsledek bez solidu (`TopExp_Explorer(výsledek, TopAbs_SOLID).More()` je `false`) → `'operation-failed'`.

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
- Záznam tvaru (`AabbEntry`) je AABB. `makeBox` uloží `[origin, origin + size]`. Od M11: `makeCylinder` uloží AABB válce pro libovolnou osu (`â` jednotková osa, v ose `k` rozšíření `radius · sqrt(1 − â_k²)` kolem obou podstav); `transform` AABB osmi rohů vstupního AABB po `mat4.transformPoint`; `boolean('union')` obalový AABB všech vstupů, `'subtract'` obalový AABB cílů (jeden cíl beze změny – fake nic neodečítá), `'intersect'` průnik obalu cílů s obalem nástrojů, prázdný nebo nulové tloušťky → `'operation-failed'`. Validace vstupů je stejná jako u OCCT.
- `tessellate` vrací AABB jako kvádr: 6 ploch po 2 trojúhelnících (24 vrcholů, normály ploch), pořadí ploch −X, +X, −Y, +Y, −Z, +Z. Dál 12 hran po 2 bodech. Platí pro každý tvar, i válec a výsledek booleanu.
- Volání `failNext` se týká jen dalšího volání dané metody. Injektovaná chyba nevytvoří handle a nic neuvolní.
- Výsledky se vrací asynchronně (v mikroúloze), nikdy synchronně, aby testy vyšších vrstev nespoléhaly na pořadí, které by s workerem neplatilo.

## Testy

- **Kontraktová sada** `describeGeometryKernelContract` v `kernel/testing.ts`, spuštěná pro `FakeKernel` (M5) a pro `OcctKernelImpl` přímo v Node (M7, `src/kernel-occt/*.test.ts` v projektu `unit`, tedy v `npm run check`; modul OCCT se načte jednou na soubor, [[Q051 Kde běží kontraktové testy OCCT|Q051]]). Pokrývá každou odrážku [[#Kontrakt (platí pro každou implementaci)|kontraktu]]:
  - nové handle po každé operaci, nikdy znovu použité,
  - všechny kódy chyb, odmítnutí místo synchronní výjimky, atomicitu `release`, `liveHandleCount`,
  - **kvádr:** bounding box, síť projde `validateMeshData`, právě 6 ploch s indexy 0–5 a 12 hran s indexy 0–11, každá plocha má aspoň 2 trojúhelníky, body leží v AABB a pokrývají ho, normály trojúhelníků jedné plochy jsou shodné, kolmé ke stěně (rovnoběžné se souřadnicovou osou), míří **ven** a šest ploch leží na šesti různých stěnách (navinutí trojúhelníku souhlasí s normálou),
  - nové buffery při každém `tessellate`,
  - **M11** (bbox s tolerancí 1e-5, nic, co platí jen pro jedno jádro): `makeCylinder` pro osy X, Y a nejednotkovou Z a každý neplatný vstup; `transform` posun, rotace o 90° a 45° kolem Z, vstup zůstává platný, nerigidní matice (zrcadlení, měřítko, zkosení, `NaN`) → `'invalid-input'`; `boolean` – `union` překrývajících se i oddělených kvádrů (obalový bbox), `intersect` překrývajících se (přesný průnik) a oddělených (`'operation-failed'`, žádný handle), `subtract` s nástrojem, který odřízne roh (bbox cíle), neplatné seznamy a `op`; síť každého výsledku projde `validateMeshData` a leží v bbox; izolace vstupů.
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

## Otevřené otázky

Otázky jsou samostatné poznámky v `60-otazky/` a odkazují sem. Novou otázku založ šablonou *Otázka*.

![[otazky.base#Otázky k této poznámce]]
