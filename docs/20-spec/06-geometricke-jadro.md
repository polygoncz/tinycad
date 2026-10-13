---
type: spec
status: accepted
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
tags:
  - spec
created: 2026-10-12
updated: 2026-10-13
---
# 06 – `kernel` a `kernel-occt`: geometrické jádro

> **Pojmy:** [[Geometrické jádro]], [[Handle tvaru]], [[Port a adaptér]]  
> **Rozhodnutí:** [[0002-occt-wasm-ve-workeru]], [[0011-programovani-proti-rozhranim]], [[Q039 Chyby jádra přes hranici workeru|Q039]]  
> **Milník:** [[M05-kernel-port]], [[M07-kernel-occt]]

Geometrické jádro je za **portem** `GeometryKernel`. Doména (`regen`) zná jen rozhraní. Konkrétní implementace:

- **OCCT** (`kernel-occt`): OpenCascade ve WASM, běží ve Web Workeru ([[0002-occt-wasm-ve-workeru|ADR 0002]]). Tovární funkce `createOcctKernel(): Promise<GeometryKernel & Disposable>` (počká na start workeru) – M7.
- **Fake** (`kernel`): jednoduchá implementace v paměti pro testy vyšších vrstev, umí jen kvádry jako AABB. `createFakeKernel(): FakeKernel` z `kernel/testing.ts` – M5.

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
│  createdBy: FeatureId      │                │    TopTools_IndexedMapOfShape    │
│  names: topologická jména  │ ◄───────────── │  mesh?: cache tessellace         │
└────────────────────────────┘  MeshData,     │  history/roles z algoritmu       │
       „co tvar znamená“         bbox… (data) └──────────────────────────────────┘
                                                „co OCCT má a jak to najít“
```

- **`ShapeEntry` (adaptér):** handle je klíč do tabulky `HandleTable<ShapeHandle, ShapeEntry>`. Záznam drží tvar a **mapy podtvarů** spočítané jednou při vzniku tvaru (`TopExp::MapShapes`). Díky nim je `SubShapeIndex` pro daný handle stabilní napříč dotazy (síť, topologie, historie). Dál drží cache sítě, role a historii. Je soukromý v adaptéru. `FakeKernel` má vlastní záznam `{ min, max }` (AABB).
- **`Body` (doména, [[07-regenerace|spec 07]]):** stabilní `BodyId` napříč regeneracemi (handle se mění při každé), featura, která těleso vytvořila, a od M14 topologická jména. UI, výběr i reference featur odkazují na `Body` a jména, nikdy na handle.
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

### Plánované rozšíření

Přidávají se do `GeometryKernel` v milníku, který je potřebuje, a kontraktová sada se o ně rozšíří:

```ts
// PrimitiveOps (M11)
makeCylinder(p: { base: Vec3; axis: Vec3; radius: number; height: number }): Promise<ShapeResult>;

export interface TransformOps {      // podle potřeby (M11+)
  transform(shape: ShapeHandle, m: Mat4): Promise<ShapeResult>;
}
export interface BooleanOps {        // podle potřeby (M11+)
  boolean(op: 'union' | 'subtract' | 'intersect', targets: readonly ShapeHandle[], tools: readonly ShapeHandle[]): Promise<ShapeResult>;
}
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
- **`tessellate`:** `linearDeflection` i `angularDeflection` jsou konečná čísla > 0, jinak `'invalid-input'`. Neznámý handle → `'unknown-handle'`. Každé volání vrací **nové** buffery, nesdílené s jiným voláním, s jiným polem téže sítě ani s vnitřním stavem jádra, takže je volající smí přenést jako transferable. Že opakované volání vrátí stejná data, se **nezaručuje** (OCCT může síť zjemnit).
- **`boundingBox`:** neznámý handle → `'unknown-handle'`. Vrací nový objekt.
- **`release`:**
  - Prázdné pole → nic.
  - Neznámý nebo už uvolněný handle → `'unknown-handle'`. Stejný handle dvakrát v jednom volání → `'invalid-input'`.
  - **Atomický:** při chybě se neuvolní nic. Přísnost odhalí chyby v mark & sweep, které by tolerantní `release` skryl.
- **`liveHandleCount`:** počet vytvořených a neuvolněných handle. Neúspěšná operace žádný handle nevytvoří.
- **Více chyb najednou** (např. neznámý handle i neplatná kvalita): který kód se vrátí, není určeno a sada to netestuje. `FakeKernel` dává přednost chybě z `failNext`.
- **Izolace:** jádro si neponechává odkaz na vstupní objekty (`origin`, `size`, pole handle) a **čte je synchronně při volání**, jako by je klonoval `postMessage`. Změna vstupu hned po volání (před `await`) výsledek neovlivní. Vrácená data nesdílí paměť s ničím jiným.

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
  readonly positions: Float32Array;   // xyz
  readonly normals: Float32Array;     // xyz, jednotkové, jedna na vrchol
  readonly indices: Uint32Array;      // trojúhelníky, proti směru hodinových ručiček při pohledu zvenku
  /** Rozsahy trojúhelníků podle B-rep plochy, pro picking a zvýraznění plochy. */
  readonly faceRanges: Uint32Array;   // trojice [faceIndex, firstTriangle, triangleCount] za sebou
  /** Polyline hran: body za sebou, rozsahy podle hrany. */
  readonly edgePositions: Float32Array;
  readonly edgeRanges: Uint32Array;   // trojice [edgeIndex, firstPoint, pointCount]
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
- `regen` chybu zachytí a označí featuru jako chybnou (`KERNEL`). Nikdy nespadne celá regenerace. Chyba bez kódu jádra (např. `RpcError` `'disconnected'`, [[Q037 Pád workeru a čekající RPC volání|Q037]]) je pro `regen` také chyba jádra.

## `kernel-occt`: architektura adaptéru

```
hlavní vlákno                          Web Worker
┌──────────────────────┐   rpc    ┌────────────────────────────────┐
│ OcctKernelClient     │ ───────► │ occt.worker.ts                 │
│ implements           │          │   serveRpc(OcctKernelImpl)     │
│ GeometryKernel       │ ◄─────── │ OcctKernelImpl                 │
└──────────────────────┘ transfer │   HandleTable<number, Shape>   │
                                  │   naming roles, history        │
                                  │   tessellation (BRepMesh)      │
                                  │ OCCT WASM modul                │
                                  └────────────────────────────────┘
```

- `OcctKernelClient` je tenký, jen převádí volání na RPC. Chyby nepřevádí, kód přežije v `RpcError`.
- `OcctKernelImpl` drží tabulku handle → `ShapeEntry` ([[#Datové struktury na obou stranách]]) a veškerou práci s OCCT. Všechny OCCT objekty vytvořené v metodě uvolňuje (`.delete()` u embind objektů) v `try/finally`.
- Inicializace WASM (desítky MB) proběhne jednou při startu workeru, klient vystaví `ready: Promise<void>`.
- Worker zpracovává požadavky sériově. Dlouhé operace (fillet) blokují další, pro začátek je to přijatelné.

### Volba WASM buildu OCCT (spike v M7)

| Varianta | Pro | Proti |
|---|---|---|
| `opencascade.js` (předpřipravený build) | rychlý start, celé API z JS | velký soubor, projekt se vyvíjí pomalu, volání tisíců vazeb z TS je upovídané |
| `replicad-opencascadejs` (zúžený build z projektu replicad) | menší, udržovaný | jen podmnožina API |
| **Vlastní C++ modul přes Emscripten + embind** | úzké API přesně podle `GeometryKernel`, logika v C++, které Pavel zná; malý soubor | nutnost sestavit OCCT pro Emscripten, složitější build |

Doporučení: začít předpřipraveným buildem (rychle k výsledku), ale držet port úzký, aby šlo později přejít na vlastní C++ modul beze změny zbytku aplikace. Přechod může být samostatný pozdější milník, výborná ukázka síly portu.

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
- Záznam tvaru je AABB. `makeBox` uloží `[origin, origin + size]`.
- `tessellate` vrací kvádr jako 6 ploch po 2 trojúhelnících (24 vrcholů, normály ploch), pořadí ploch −X, +X, −Y, +Y, −Z, +Z. Dál 12 hran po 2 bodech. Pro budoucí `transform` posune AABB a pro `boolean('union')` vrátí obalový AABB (až budou v rozhraní).
- Volání `failNext` se týká jen dalšího volání dané metody. Injektovaná chyba nevytvoří handle a nic neuvolní.
- Výsledky se vrací asynchronně (v mikroúloze), nikdy synchronně, aby testy vyšších vrstev nespoléhaly na pořadí, které by s workerem neplatilo.

## Testy

- **Kontraktová sada** `describeGeometryKernelContract` v `kernel/testing.ts`, spuštěná pro `FakeKernel` (M5) a pro `OcctKernelImpl` přímo v Node (M7, `tests/kernel-occt/`). Pokrývá každou odrážku [[#Kontrakt (platí pro každou implementaci)|kontraktu]]:
  - nové handle po každé operaci, nikdy znovu použité,
  - všechny kódy chyb, odmítnutí místo synchronní výjimky, atomicitu `release`, `liveHandleCount`,
  - **kvádr:** bounding box, síť projde `validateMeshData`, právě 6 ploch s indexy 0–5 a 12 hran s indexy 0–11, každá plocha má aspoň 2 trojúhelníky, body leží v AABB a pokrývají ho, normály trojúhelníků jedné plochy jsou shodné, kolmé ke stěně (rovnoběžné se souřadnicovou osou), míří **ven** a šest ploch leží na šesti různých stěnách (navinutí trojúhelníku souhlasí s normálou),
  - nové buffery při každém `tessellate`.
- `validateMeshData`: platná síť, každé pravidlo porušené zvlášť.
- `kernelErrorCode`: vlastní chyba, `RpcError` se stejným kódem, cizí kód a ne-chyba → `undefined`.
- `FakeKernel` navíc: `failNext` (jednorázové, fronta, bez vedlejších účinků), `callCount`.

## Otevřené otázky

Otázky jsou samostatné poznámky v `60-otazky/` a odkazují sem. Novou otázku založ šablonou *Otázka*.

![[otazky.base#Otázky k této poznámce]]
