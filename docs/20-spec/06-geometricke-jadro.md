---
type: spec
status: draft
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
updated: 2026-10-12
---
# 06 – `kernel` a `kernel-occt`: geometrické jádro

> **Pojmy:** [[Geometrické jádro]], [[Handle tvaru]], [[Port a adaptér]]  
> **Rozhodnutí:** [[0002-occt-wasm-ve-workeru]]  
> **Milník:** [[M05-kernel-port]], [[M07-kernel-occt]]

Geometrické jádro je za **portem** `GeometryKernel`. Doména (`regen`) zná jen rozhraní. Konkrétní implementace:

- `OcctKernelClient` (`kernel-occt`) – OpenCascade ve WASM, běží ve Web Workeru ([[0002-occt-wasm-ve-workeru|ADR 0002]]),
- `FakeKernel` (`kernel`) – jednoduchá implementace v paměti pro testy vyšších vrstev, umí jen kvádry jako AABB.

## Handle místo tvarů

`TopoDS_Shape` žije ve workeru a nikdy neopouští jeho paměť. Ven jde jen neprůhledné číslo:

```ts
export type ShapeHandle = Brand<number, 'ShapeHandle'>;
```

- Každá operace vrací **nový** handle; vstupní handle se nemění (neměnnost jako v doméně).
- Handle se musí uvolnit (`release`). O životnost se stará `regen` (mark & sweep, viz [[07-regenerace|07]]).
- Handle jsou platné jen v rámci jedné instance jádra. Neukládají se, neodkazuje se na ně z dokumentu.

## Rozhraní (segregované)

Rozhraní je rozdělené podle schopností (interface segregation). Builder featury si vezme jen to, co potřebuje. Rozhraní **roste s milníky** – nic se nepřidává do zásoby.

```ts
export interface PrimitiveOps {
  makeBox(p: { origin: Vec3; size: Vec3 }): Promise<ShapeResult>;
  makeCylinder(p: { base: Vec3; axis: Vec3; radius: number; height: number }): Promise<ShapeResult>;
}

export interface TransformOps {
  transform(shape: ShapeHandle, m: Mat4): Promise<ShapeResult>;
}

export interface BooleanOps {
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

export interface MeshOps {
  tessellate(shape: ShapeHandle, q: { linearDeflection: number; angularDeflection: number }): Promise<MeshData>;
}

export interface QueryOps {
  topology(shape: ShapeHandle): Promise<TopologySummary>;   // počty a typy ploch/hran, pro naming a ladění
  boundingBox(shape: ShapeHandle): Promise<{ min: Vec3; max: Vec3 }>;
}

export interface ExchangeOps {       // M15
  exportStep(shapes: readonly ShapeHandle[]): Promise<Uint8Array>;
}

export interface LifecycleOps {
  release(handles: readonly ShapeHandle[]): Promise<void>;
  liveHandleCount(): Promise<number>;  // pro testy úniků
}

export interface GeometryKernel extends PrimitiveOps, TransformOps, BooleanOps, MeshOps, QueryOps, LifecycleOps {}
```

### Výsledek operace a historie

Aby šlo stavět topologické pojmenování ([[08-topologicke-pojmenovani|08]]), vrací každá operace kromě tvaru i **historii**: co ze vstupu vzniklo, co se změnilo, co zaniklo. V OCCT to odpovídá `BRepBuilderAPI_MakeShape::Generated / Modified / IsDeleted`.

```ts
export interface ShapeResult {
  readonly shape: ShapeHandle;
  readonly history?: ShapeHistory;   // do M14 volitelné
  readonly roles?: Readonly<Record<string, SubShapeIndex[]>>; // pojmenované části, např. { 'face:top': [5] }
}

/** Index podtvaru = pozice v TopExp::MapShapes(shape, TopAbs_FACE/EDGE/VERTEX). */
export interface SubShapeIndex { readonly type: 'face' | 'edge' | 'vertex'; readonly index: number }

export interface ShapeHistory {
  /** Pro každý vstupní tvar: index podtvaru ve vstupu → indexy podtvarů ve výstupu. */
  readonly modified: readonly HistoryLink[];
  readonly generated: readonly HistoryLink[];
  readonly deleted: readonly { input: number; sub: SubShapeIndex }[];
}
export interface HistoryLink { readonly input: number; readonly from: SubShapeIndex; readonly to: readonly SubShapeIndex[] }
```

Indexy podtvarů jsou platné jen pro konkrétní handle – nejsou stabilní napříč regeneracemi. Stabilitu zajišťují až jména.

### Síť pro vykreslení

```ts
export interface MeshData {
  readonly positions: Float32Array;   // xyz
  readonly normals: Float32Array;
  readonly indices: Uint32Array;
  /** Rozsahy trojúhelníků podle B-rep plochy – pro picking a zvýraznění plochy. */
  readonly faceRanges: Uint32Array;   // trojice [faceIndex, firstTriangle, triangleCount] za sebou
  /** Polyline hran: body za sebou, rozsahy podle hrany. */
  readonly edgePositions: Float32Array;
  readonly edgeRanges: Uint32Array;   // trojice [edgeIndex, firstPoint, pointCount]
}
```

Ploché typed arrays, aby šly přes `postMessage` přenést jako transferable bez kopírování.

### Chyby

Operace jádra selhávají běžně (neplatný boolean, fillet s příliš velkým poloměrem). Chyba se vrací jako rejected promise s `KernelError`:

```ts
export class KernelError extends Error {
  constructor(readonly code: KernelErrorCode, message: string) { super(message) }
}
export type KernelErrorCode = 'INVALID_INPUT' | 'OPERATION_FAILED' | 'UNKNOWN_HANDLE' | 'INTERNAL';
```

`regen` chybu zachytí a označí featuru jako chybnou – nikdy nespadne celá regenerace.

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

- `OcctKernelClient` je tenký – jen převádí volání na RPC.
- `OcctKernelImpl` drží tabulku handle → `TopoDS_Shape` a veškerou práci s OCCT. Všechny OCCT objekty vytvořené v metodě uvolňuje (`.delete()` u embind objektů) v `try/finally`.
- Inicializace WASM (desítky MB) proběhne jednou při startu workeru; klient vystaví `ready: Promise<void>`.
- Worker zpracovává požadavky sériově. Dlouhé operace (fillet) blokují další – pro začátek přijatelné.

### Volba WASM buildu OCCT (spike v M7)

| Varianta | Pro | Proti |
|---|---|---|
| `opencascade.js` (předpřipravený build) | rychlý start, celé API z JS | velký soubor, projekt se vyvíjí pomalu, volání tisíců vazeb z TS je upovídané |
| `replicad-opencascadejs` (zúžený build z projektu replicad) | menší, udržovaný | jen podmnožina API |
| **Vlastní C++ modul přes Emscripten + embind** | úzké API přesně podle `GeometryKernel`, logika v C++, které Pavel zná; malý soubor | nutnost sestavit OCCT pro Emscripten, složitější build |

Doporučení: začít předpřipraveným buildem (rychle k výsledku), ale držet port úzký, aby šlo později přejít na vlastní C++ modul beze změny zbytku aplikace. Přechod může být samostatný pozdější milník – výborná ukázka síly portu.

## `FakeKernel`

- Žije v `kernel` (ne v testech), aby ho mohly používat testy všech vyšších modulů.
- `makeBox` vrací handle s AABB, `transform` posouvá AABB, `boolean('union')` vrací obalový AABB, `tessellate` vrací 12 trojúhelníků s 6 plochami.
- Umí simulovat chybu (`fake.failNext('makeBox', 'OPERATION_FAILED')`).
- Počítá živé handle → testy regenerace ověřují, že nic neuniká.

## Testy

- Kontraktové testy `GeometryKernel` (sdílené pro `FakeKernel` a `OcctKernelImpl`): handle po release je neplatný, chyby mají správný kód, nové handle po každé operaci.
- `OcctKernelImpl` přímo v Node (bez workeru) – integrační testy v `tests/kernel-occt/`, pomalejší, spouští se zvlášť.
- Tessellace kvádru: 6 ploch, 12 hran, `faceRanges` pokrývají všechny trojúhelníky.

## Otevřené otázky

Otázky jsou samostatné poznámky v `60-otazky/` a odkazují sem. Novou otázku založ šablonou *Otázka*.

![[otazky.base#Otázky k této poznámce]]
