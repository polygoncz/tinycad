---
type: spec
status: implemented
order: 6
aliases:
  - kernel – geometrické jádro
  - Spec 06
modules:
  - kernel
  - server
milestones:
  - "[[M05-kernel-port]]"
  - "[[M07-kernel-occt]]"
  - "[[M11-dalsi-entity]]"
  - "[[M12-skicar]]"
  - "[[M13-extrude-revolve]]"
  - "[[M14-topologicke-pojmenovani]]"
  - "[[M15-export-a-dokonceni]]"
  - "[[M16-vlastni-occt-build]]"
  - "[[M42-jadro-occt-nativne]]"
  - "[[M47-uklid-a-dokonceni]]"
  - "[[M50-occt2d-a-vrstva-rpc]]"
tags:
  - spec
created: 2026-10-12
updated: 2026-10-17
---
# 06 – `kernel`: geometrické jádro

> **Pojmy:** [[Geometrické jádro]], [[Handle tvaru]], [[Port a adaptér]]  
> **Rozhodnutí:** [[0030-nativni-jadro-pres-grpc|ADR 0030]], [[0011-programovani-proti-rozhranim]], [[Rozhodnutí nativního jádra|N13–N16]], [[Q039 Chyby jádra přes hranici workeru|Q039]]  
> **Milník:** [[M05-kernel-port]], [[M07-kernel-occt]], [[M11-dalsi-entity]], [[M42-jadro-occt-nativne]]  
> **Archiv:** [[06-geometricke-jadro v prohlížeči]] (OCCT WASM ve workeru a `FakeKernel` do M46)

Geometrické jádro je za **portem** `GeometryKernel`. Regenerace (`server/src/regen`) a buildery featur znají jen rozhraní (buildery jen jeho část `ModelingKernel`). Implementace je jediná:

- **Nativní OCCT na serveru** (od [[M42-jadro-occt-nativne|M42]], [[0030-nativni-jadro-pres-grpc|ADR 0030]]): **OCCT 8.0.1** z registru vcpkg (baseline `a5f73622`, triplet `arm64-linux-release`). Třída `OcctKernel` v knihovně `tinycad_kernel` (`server/src/kernel`), hlavičky v `server/src/kernel/include/tinycad/kernel/`: port `kernel.hpp`, `occt_kernel.hpp`, typy `types.hpp`, `profile.hpp`, `mesh.hpp`, `errors.hpp`. 2D geometrie skicáře (`curveIntersections`, `curveSegment`, `filletArc`, `offsetCurves`) není v portu jádra, ale v knihovně `tinycad_geometry` (`server/src/geometry`) za `GeometryService` ([[Rozhodnutí nativního jádra|N15]], [[14-protokol#`GeometryService`]]).

**Zápis v této specifikaci:** signatury zůstávají v TypeScriptu jako zápis kontraktu ([[Rozhodnutí nativního jádra|N128]]); C++ se liší jen formou. Metody jsou synchronní a vrací `KernelResult<T>` = `std::expected<T, KernelError>` místo `Promise` a nikdy nevyhazují, jednu instanci obsluhuje jeden volající ([[Rozhodnutí nativního jádra|N13]]); `ShapeHandle` je `enum class` nad `uint64_t` a tabulka tvarů žije v `OcctKernel::Impl` (pimpl, [[Rozhodnutí nativního jádra|N14]]); `ModelingKernel` je v hlavičce jádra ([[Rozhodnutí nativního jádra|N16]]); `exportStep` vrací `std::string`. „Odmítnutý `Promise` s kódem“ v textu níže znamená v C++ `KernelResult` s `KernelError` toho kódu.

Do M46 běželo jádro v prohlížeči jako OpenCascade ve WASM ve Web Workeru (`kernel-occt`) a testy vyšších vrstev používaly TS `FakeKernel`: [[06-geometricke-jadro v prohlížeči]].

Třídy jsou skryté v modulech, ven jdou rozhraní a tovární funkce ([[0011-programovani-proti-rozhranim|ADR 0011]]). Typy OCCT nejsou ve veřejných hlavičkách.

## Co z jádra zná klient

Prohlížeč jádro nemá. TS modul `kernel` (prstenec 1, importuje jen `core`) po M47 obsahuje jen **typy** pro `render` a `remote` ([[Rozhodnutí nativního jádra|N122]]): `MeshData`, `MeshQuality`, `ShapeHandle`, `BoundingBox`, `MeshOps`, typy oblastí profilu `ProfileRegion`/`ProfileLoop`/`ProfileCurve`, chyby `KernelErrorCode`, `createKernelError` a kontrolu `validateMeshData` (volá ji `remote` u každé sítě ze serveru); `kernelErrorCode` je jen v `kernel/testing.ts`. `GeometryKernel`, kontroly vstupů (`parse*Input`, `validateFaceInput`), `isRigidMotion`, `FakeKernel` a kontraktová sada z klienta zmizely. Sítě těles přichází z read modelu podle `content_version` ([[14-protokol#Read model a sítě]]), oblasti a 2D geometrie skici z `GeometryService`; `MeshOps` je port, přes který `render` síť dostane (v klientovi ji dodá vzdálený adaptér, ne jádro).

## Handle místo tvarů

`TopoDS_Shape` žije v tabulce tvarů `OcctKernel` a nikdy jádro neopustí. Ven jde jen neprůhledné číslo, [[Handle tvaru|handle]] (v C++ `enum class ShapeHandle : uint64_t`, `types.hpp`):

```ts
export type ShapeHandle = Brand<number, 'ShapeHandle'>;
```

- Každá operace vrací **nový** handle. Vstupní handle se nemění (neměnnost jako v doméně).
- Handle je kladné celé číslo a **v rámci jedné instance jádra se nikdy nepoužije znovu** (rostoucí čítač). Uvolněný handle proto spolehlivě skončí chybou `'unknown-handle'`, nikdy nezamění tvar. Na tom stojí mark & sweep v [[07-regenerace#Životnost handle: mark & sweep|regeneraci]] a `content_version` tělesa ([[Rozhodnutí nativního jádra|N43]]).
- Handle se musí uvolnit (`release`). O životnost se stará `regen` (mark & sweep).
- Handle platí jen v rámci jedné instance jádra. Neukládají se a dokument na ně neodkazuje. Handle z jiné instance jádra rozpoznat nejde (je to jen číslo). Server má jedno jádro na běhový dokument ([[Rozhodnutí nativního jádra|N54]]); zničení jádra uvolní všechny tvary (RAII).
## Datové struktury na obou stranách

Port přenáší jen **identitu** (handle) a **hodnoty** (síť, bounding box, indexy podtvarů, historie). Obaly kolem tvarů žijí na obou stranách hranice a každý drží něco jiného:

```
regenerace (server/src/regen)                  jádro (server/src/kernel, pimpl)
┌────────────────────────────┐                ┌──────────────────────────────────┐
│ regen: Body                │   ShapeHandle  │ OcctKernel::Impl: ShapeEntry     │
│  id: BodyId (stabilní)     │ ─────────────► │  shape: TopoDS_Shape             │
│  shape: ShapeHandle        │   (jen číslo)  │  faces/edges/vertices:           │
│  origin: FeatureId         │                │    TopTools_IndexedMapOfShape    │
│  names: topologická jména  │ ◄───────────── │  mesh?: cache tessellace         │
└────────────────────────────┘  MeshData,     │  history/roles z algoritmu       │
       „co tvar znamená“         bbox… (data) └──────────────────────────────────┘
                                                „co OCCT má a jak to najít“
```

- **`ShapeEntry` (adaptér):** handle je klíč do soukromé `Map<ShapeHandle, ShapeEntry>`. Záznam drží tvar a **mapy podtvarů** spočítané jednou při vzniku tvaru (`TopExp::MapShapes` do `NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher>`, `server/src/kernel/shape_table.hpp`, [[#Adaptér `OcctKernel`|viz adaptér]]). Díky nim je `SubShapeIndex` pro daný handle stabilní napříč dotazy (síť, topologie, historie). Od M14 drží navíc role hran profilu z `makeFace`. Je soukromý v adaptéru.
- **`Body` (doména, [[07-regenerace|spec 07]]):** stabilní `BodyId` napříč regeneracemi (handle se mění při každé), rodokmen (`origin`, `lastModifiedBy`, [[0015-artefakty-a-identita-telesa|ADR 0015]]) a od M14 topologická jména. UI, výběr i reference featur odkazují na `Body` a jména, nikdy na handle.
- V regeneraci **nejsou** objekty obalující tvar (proxy s metodami `shape.mesh()`). Neměly by vlastní data a míchaly by „co tvar znamená“ (`Body`) s „co spočítalo jádro“ (`ShapeEntry`).
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

`transform` přijímá jen tuhé pohyby ([[Rozhodnutí noční rychloakce#M11 – Další entity|R7]]): `gp_Trsf` v OCCT zrcadlení a měřítko sice umí, ale zrcadlení otočí navinutí trojúhelníků a měřítko mění geometrii (kopie místo lokace). Featura Transform v M11 nic jiného nepotřebuje. `isRigidMotion` je jedna kontrola (v C++ `mesh.hpp`).

Výsledek booleanu je v M11 **vždy jeden handle** (u více cílů nebo nesouvislého výsledku compound více solidů). Rozpad na více těles podle historie jádra přijde s historií v [[M14-topologicke-pojmenovani|M14]] ([[Rozhodnutí noční rychloakce#M11 – Další entity|R8]]).

### Stav po M12

M12 přidal rovinnou plochu z uzavřených smyček – profil skici jako handle v jádře ([[12-skicar#Oblasti (profily)]], [[0017-modul-sketch-a-skicar|ADR 0017]], nález 9 z [[Revize architektury 2026-10-13]]):

```ts
/** 2D křivka v rovině; stejný tvar jako Curve2 ze sketch (kernel na sketch nezávisí, shodu hlídá strukturální typování v builderu skici). */
export type ProfileCurve =
  | { readonly kind: 'line'; readonly from: Vec2; readonly to: Vec2 }
  | { readonly kind: 'arc'; readonly center: Vec2; readonly from: Vec2; readonly to: Vec2; readonly ccw: boolean }
  | { readonly kind: 'circle'; readonly center: Vec2; readonly radius: number };
export type ProfileLoop = readonly ProfileCurve[];

export interface SketchOps {
  /** Rovinná plocha v rovině plane ohraničená smyčkou outer, s dírami holes. Souřadnice smyček jsou v rovině (x = xDir, y = normal × xDir). */
  makeFace(p: { readonly plane: Plane; readonly outer: ProfileLoop; readonly holes: readonly ProfileLoop[] }): Promise<ShapeResult>;
}

export interface GeometryKernel extends PrimitiveOps, TransformOps, BooleanOps, SketchOps, MeshOps, QueryOps, LifecycleOps {}
```

`Plane` a `Vec2` jsou z `core` ([[02-core]]). Builder skici volá `makeFace` jednou na oblast; křivky skici jako drát (`makeSketchCurves`) a `tessellateCurves` nevznikají – skicu kreslí `render` z dat ([[Rozhodnutí noční rychloakce#M12 – Skicář|R34]]).

**M29 (spliny skici):** `ProfileCurve` (a `Curve2` ve `sketch`) má variantu `{ kind: 'bspline'; degree: number; poles: readonly Vec2[]; knots: readonly number[]; id?: string }` – polynomiální sevřený (clamped) B-spline bez vah ([[12-skicar#Spliny (M29)]]). `validateFaceInput` ověří: `degree` celé 1–25 (25 = `Geom_BSplineCurve::MaxDegree()`), aspoň `degree + 1` konečných řídicích bodů, `knots.length = poles.length + degree + 1`, uzly konečné a sevřené (prvních `degree + 1` stejných, posledních `degree + 1` stejných, první < poslední), vnitřní uzly ostře mezi krajními, neklesající, žádný víc než `degree`krát; jinak `'invalid-input'`. Začátek křivky = první řídicí bod, konec = poslední (napojení smyčky jako u ostatních křivek). Obrácená křivka = řídicí body pozpátku, uzly zrcadlené. Role hrany `edge:<id>` a boční plochy `face:side:<id>` jako u ostatních křivek.

### Stav po M13

M13 přidal tažení rovinné plochy – hranol a rotaci ([[M13-extrude-revolve|M13]], [[Rozhodnutí noční rychloakce#M13 – Extrude a Revolve|R61]]). Profil je **handle plochy** z `makeFace` (oblast skici), ne data: `ProfileInput` z původního plánu odpadá, plochu už jádro má.

```ts
/** Osa: bod a směr (nemusí být jednotkový). */
export interface Axis { readonly origin: Vec3; readonly direction: Vec3 }

export interface SweepOps {
  /** Hranol: plocha profile posunutá o distance ve směru direction (jádro směr normalizuje). */
  extrude(profile: ShapeHandle, direction: Vec3, distance: number): Promise<ShapeResult>;
  /** Rotační těleso: plocha profile otočená kolem osy o angle (radiány, kladně podle pravidla pravé ruky kolem axis.direction). */
  revolve(profile: ShapeHandle, axis: Axis, angle: number): Promise<ShapeResult>;
}

export interface GeometryKernel extends PrimitiveOps, TransformOps, BooleanOps, SketchOps, SweepOps, MeshOps, QueryOps, LifecycleOps {}
```

- Jedna plocha na volání. Featura s více oblastmi zavolá `extrude` pro každou a výsledky spojí přes `boolean` (pravidla v [[07-regenerace#Operace tělesa (M13)]]); jádro tak nemusí umět compound profilů.
- Symetrické vysunutí si builder složí z `transform` plochy o −d/2 a `extrude` o d; jádro „symetricky“ nezná.
- `roles` (start, konec, boční plochy) M13 **nevyplňuje** ([[Rozhodnutí noční rychloakce#M13 – Extrude a Revolve|R64]] ⚠): boční plochy potřebují vazbu hran plochy na id entit skici, kterou `makeFace` nevrací, a role bez historie booleanu by po „přidat/odebrat“ stejně neplatily. Obojí přijde s historií v [[M14-topologicke-pojmenovani|M14]].

### Stav po M14

M14 přidal topologii tvaru, role a historii u všech operací a zaoblení/zkosení hran ([[M14-topologicke-pojmenovani|M14]], [[08-topologicke-pojmenovani|spec 08]], [[Rozhodnutí noční rychloakce#M14 – Topologické pojmenování|R91–R98]]):

```ts
// kernel/types.ts
export type SurfaceType = 'plane' | 'cylinder' | 'cone' | 'sphere' | 'torus' | 'other';
/** Rovina rovinné plochy: bod na rovině a jednotková normála ven z tělesa (orientace plochy započtená). */
export interface FacePlane { readonly origin: Vec3; readonly normal: Vec3 }
export interface FaceInfo { readonly surface: SurfaceType; readonly plane?: FacePlane }   // plane právě u 'plane'
export interface EdgeInfo {
  readonly faces: readonly number[];      // sousední plochy, vzestupně bez duplicit (šev pláště: jedna)
  readonly vertices: readonly number[];   // koncové vrcholy, vzestupně bez duplicit (uzavřená hrana: jeden, bez vrcholu: žádný)
  readonly midpoint: Vec3;                // bod hrany v polovině parametru (jen pro rozlišení #k, spec 08)
}
export interface TopologySummary {
  readonly faces: readonly FaceInfo[];    // index = SubShapeIndex plochy
  readonly edges: readonly EdgeInfo[];    // index = SubShapeIndex hrany
  readonly vertexCount: number;
}

// kernel/profile.ts: ProfileCurve dostává u všech tří druhů readonly id?: string (id entity skici, R98)

export interface QueryOps {
  boundingBox(shape: ShapeHandle): Promise<BoundingBox>;
  topology(shape: ShapeHandle): Promise<TopologySummary>;          // M14
}

export interface DressupOps {                                       // M14
  /** Zaoblení hran edges (indexy hran tvaru shape) poloměrem radius. */
  fillet(shape: ShapeHandle, edges: readonly number[], radius: number): Promise<ShapeResult>;
  /** Symetrické zkosení hran o distance. */
  chamfer(shape: ShapeHandle, edges: readonly number[], distance: number): Promise<ShapeResult>;
}

export interface GeometryKernel
  extends PrimitiveOps, TransformOps, BooleanOps, SketchOps, SweepOps, DressupOps, MeshOps, QueryOps, LifecycleOps {}
```

- **Role** (`ShapeResult.roles`, klíče bez id featury, [[0018-format-topologickych-jmen|ADR 0018]]): `makeBox` → `face:top|bottom|front|back|left|right` podle světových os (+Z, −Z, −Y, +Y, −X, +X; [[Rozhodnutí noční rychloakce#M14 – Topologické pojmenování|R93]]), každá právě jedna plocha; `makeCylinder` → `face:bottom`, `face:top`, `face:side`; `makeFace` → `edge:<id>` pro každou křivku s `id` (hrana plochy z té křivky); `extrude` → `face:start`, `face:end`, `face:side:<id>` (boční plochy z hran profilu, které mají roli `edge:<id>`); `revolve` → `face:side:<id>` a `face:start`, `face:end`, jen pokud ve výsledku existují (úhel < 2π). Ostatní operace role nevrací.
- **Role hran profilu si jádro pamatuje u handle** (u plochy z `makeFace`) a `transform` je přenese na nový handle; `extrude`/`revolve` z nich počítají `face:side:<id>`. Port tak nese id entit skici jen jako neprůhledné řetězce (kernel na `sketch` nezávisí).
- **Historie** (`ShapeResult.history`) u operací se vstupními tvary: `transform` (vstup 0), `boolean` (vstupy = `[...targets, ...tools]` v pořadí volání), `extrude`, `revolve` (vstup 0 = profil), `fillet`, `chamfer` (vstup 0). Primitiva a `makeFace` historii nevrací (`undefined`). Obsah: `modified` a `deleted` jen pro **plochy** vstupů, `generated` = plochy výstupu vzniklé z plochy, hrany nebo vrcholu vstupu. Změny hran a vrcholů se nevrací – jména hran plynou z ploch ([[08-topologicke-pojmenovani#Hrany]], [[Rozhodnutí noční rychloakce#M14 – Topologické pojmenování|R91]]).
- `topology` je dotaz bez nového handle; síť (`tessellate`) a topologie téhož handle mají stejné indexy ploch a hran.

### Stav po M15

M15 přidal export do STEP ([[M15-export-a-dokonceni|M15]], [[Rozhodnutí noční rychloakce#M15 – Export a dokončení|R121–R123]]):

```ts
export interface ExchangeOps {
  /** Soubor STEP (AP214, mm) se všemi tvary shapes; bajty textu ASCII/UTF-8. */
  exportStep(shapes: readonly ShapeHandle[]): Promise<Uint8Array<ArrayBuffer>>;
}

export interface GeometryKernel
  extends PrimitiveOps, TransformOps, BooleanOps, SketchOps, SweepOps, DressupOps, ExchangeOps, MeshOps, QueryOps, LifecycleOps {}
```

- Port nese jen bajty: jméno souboru a stažení řeší `app` a `ui` ([[11-ui#Kompoziční kořen (app)]]). Barvy a jména těles STEP nenese (`STEPControl_Writer`, ne XCAF, R123 ⚠).
- `ExchangeOps` **není** v `ModelingKernel` ([[07-regenerace#Builder featury]]): builder featury nic neexportuje.
- Import STEP do modelu není; `STEPControl_Reader` používá jen test adaptéru (zpětné načtení).

### Stav po M30

M30 přesunul výpočet oblastí skici z TypeScriptu do jádra ([[M30-geometrie-skici-v-occt|M30]], [[0028-geometrie-skici-v-jadre|ADR 0028]], [[Q092 Hranice geometrie skici v TS a v OCCT|Q092]]). Nová metoda vrací **data**, ne handle – plochy dál staví `makeFace`:

```ts
// kernel/profile.ts
/** Oblast: uzavřená vnější smyčka a díry; strukturálně = SketchRegion ze sketch. */
export interface ProfileRegion {
  /** Id všech hraničních křivek (vnější i díry), bez duplicit, seřazená (porovnání řetězců), spojená ','. */
  readonly name: string;
  readonly outer: ProfileLoop;                    // proti směru hodinových ručiček, křivky orientované podél smyčky
  readonly holes: readonly ProfileLoop[];         // po směru hodinových ručiček
  readonly area: number;                          // > 0: vnější minus díry
}
export interface ProfileRegions { readonly regions: readonly ProfileRegion[]; readonly crossing: boolean }

export interface SketchOps {
  makeFace(…): Promise<ShapeResult>;              // beze změny
  /** M30: oblasti ohraničené křivkami. Bez handle, bez vedlejších účinků. */
  profileRegions(p: { readonly curves: readonly ProfileCurve[] }): Promise<ProfileRegions>;
}
```

- Je v `SketchOps`, a tedy i v `ModelingKernel` builderu ([[07-regenerace#Builder featury]]).
- Křivky ve smyčkách výsledku nesou `id` vstupní křivky a jsou orientované podél smyčky (oblouk může mít `ccw: false`, spline obrácené `poles` a uzly `a + b − k` pozpátku, kde `[a, b]` je rozsah uzlů – pro `[0, 1]` tedy `1 − k`; tatáž křivka). Výsledek jde rovnou do `makeFace` (`outer`, `holes`).
- `TrackingKernel` regenerace (`server/src/regen/src/tracking_kernel.cpp`) volání jen přeposílá (nic neuvolňuje); vstup i výsledek jsou data bez handle.

### Stav po M33

> **Od M47 ([[Rozhodnutí nativního jádra|N15]]):** metody z *Stav po M33*, *Stav po M34* a *Stav po M35* nejsou v portu jádra. Implementuje je `tinycad_geometry` (`server/src/geometry`: `intersections.cpp`, `segment.cpp`, `fillet.cpp`, `offset.cpp`, `offset_chain.cpp`, kontroly vstupu `validate.cpp`; 2D základ z `tinycad_occt2d`, viz [[#Společný 2D základ `tinycad_occt2d`]]) za `GeometryService` a skicář je volá přes síť ([[14-protokol#`GeometryService`]]). Signatury níže jsou kontrakt těchto volání. Fake implementace z TS: [[06-geometricke-jadro v prohlížeči]].

Průsečíky a kusy křivek skici pro trim, extend a split ([[M33-trim-extend-split|M33]], [[12-skicar#Trim, extend, split (M33)]]). Data, ne handle:

```ts
// kernel/profile.ts
export interface CurveIntersection {
  readonly a: string; readonly b: string;          // id křivek; a === b samoprůsečík splinu (ta < tb)
  readonly point: Vec2;
  readonly ta: number; readonly tb: number;        // parametr t podle spec 12 „Port a parametr křivky“
  readonly overlap?: true;                         // konec společného úseku překrývajících se křivek
}
export interface SketchOps {
  /** M33: všechny průsečíky dvojic křivek (a před b v pořadí vstupu) a samoprůsečíky splinů; pořadí a, b, ta. */
  curveIntersections(p: { readonly curves: readonly ProfileCurve[] }): Promise<readonly CurveIntersection[]>;
  /** M33: kus křivky mezi from < to, stejného druhu (kružnice → oblouk), s id vstupu. */
  curveSegment(p: { readonly curve: ProfileCurve; readonly from: number; readonly to: number }): Promise<ProfileCurve>;
}
```

- **`curveIntersections`:** vstup jako u `profileRegions` (kontrola jako `parseProfileRegionsInput`: id povinné a unikátní, nulové délky vynechané). Průsečíky i ve sdílených koncových bodech a tečné dotyky; překryv → oba konce společného úseku s `overlap`. Body se slučují do `1e-7 · max(1, |souřadnice|)`. Uzel uzavřeného splinu se hlásí jako samoprůsečík (`ta` první, `tb` poslední uzel). **Nehlásí se:** dvě shodné kružnice (překryv bez konců) a překryv se splinem. OCCT hlásí tečný dotyk jako krátký společný úsek; adaptér ho podle mezery uvnitř úseku převede na jeden bod. OCCT: `Geom2dAPI_InterCurveCurve` s předfiltrem obálek (jako oblasti), parametry přes `Geom2dAPI_ProjectPointOnCurve` (`InterCurveCurve` je nevrací), převedené na `t` ze spec 12. Kód: `server/src/geometry/intersections.cpp`, sdílená stavba 2D křivek a předfiltr obálek `server/src/occt2d` (`curves.cpp`, `boxes.cpp`).
- **`curveSegment`:** křivka podle tvaru z `makeFace` (bez povinného id), `from < to` v definičním oboru (`t` ze spec 12; u kružnice `to < from + 2π` – celá otáčka by byl oblouk nulové délky), jinak `'invalid-input'`; parametr do `1e-9 · max(1, |mez|)` za mezí se posune na mez. Kontrola vstupu v `server/src/geometry/validate.cpp` (port `parseCurveSegmentInput`). Úsečka a oblouk přesně ze vzorců; spline `Geom2d_BSplineCurve::Segment(from, to)` (`segment.cpp`), uzly kusu přeškálované do `[0, 1]`. Body kusu leží na původní křivce (test vzorkuje).

### Stav po M34

Střed zaoblení ve skice ([[M34-zaobleni-a-srazeni-ve-skice|M34]], [[12-skicar#Zaoblení a sražení ve skice (M34)]]):

```ts
export interface FilletArc { readonly center: Vec2; readonly pointA: Vec2; readonly pointB: Vec2; readonly ta: number; readonly tb: number }
SketchOps.filletArc(p: { readonly a: ProfileCurve; readonly b: ProfileCurve; readonly radius: number; readonly near: Vec2 }): Promise<FilletArc>;
```

- `a`, `b` úsečka nebo oblouk (tvar z `makeFace`, id nepovinné), `radius` konečné > 0, `near` konečné, jinak `'invalid-input'`. Střed ve vzdálenosti `radius` od nosné geometrie obou (nekonečná přímka, celá kružnice), nejbližší `near`; body dotyku a jejich `t` (M33; u úsečky i mimo `[0, 1]`). Bez řešení → `'operation-failed'`.
- Nekonečně mnoho středů (rovnoběžky přesně `2r` od sebe, kolineární úsečky, soustředné oblouky s mezerou `2r`) → bod společné ekvidistanty nejbližší `near`; při shodě vzdáleností první nalezený. `t` bodu dotyku mimo oblouk = úhel od `from` ve směru oblouku v `[0, 2π)`.
- OCCT: `Geom2d_OffsetCurve(±radius)` nosné geometrie – úsečka jako `Geom2d_TrimmedCurve(Geom2d_Line)` na `±1e6 · měřítko` kolem `from` (`InterCurveCurve` na ekvidistantě nekonečné přímky vyhodí výjimku; střed dál než tato mez → `'operation-failed'`), oblouk jako `Geom2d_Circle`; průsečíky `Geom2dAPI_InterCurveCurve` (tečný dotyk hlášený jako úsek jako v M33), body dotyku `Geom2dAPI_ProjectPointOnCurve`. Degenerovaná ekvidistanta oblouku (`|ρ − r|` v toleranci) se vynechá. Kód `server/src/geometry/fillet.cpp`, kontrola vstupu `validate.cpp` (port `parseFilletArcInput`).

### Stav po M35

Ekvidistanta řetězce křivek skici ([[M35-offset|M35]], [[12-skicar#Offset (M35)]]):

```ts
export type OffsetCurve = ProfileCurve & { readonly source?: string };
SketchOps.offsetCurves(p: { readonly curves: readonly ProfileCurve[]; readonly closed: boolean; readonly distance: number }): Promise<readonly OffsetCurve[]>;
```

- Vstup: křivky řetězce s id, orientované a navazující (konec jedné = začátek další do tolerance `makeFace`, u `closed` i poslední → první; kružnice jen samotná), `distance` konečné ≠ 0, jinak `'invalid-input'`. Strana: uzavřený `> 0` ven, otevřený `> 0` vpravo ve směru průchodu.
- Výstup: navazující křivky v pořadí průchodu, `source` = id vstupu (spoj bez `source`); ostré rohy ven (prodloužení), zaniklé hrany vynechané, spline → kubický B-spline v toleranci `1e-4 · měřítko`. Nemožný offset → `'operation-failed'`.
- OCCT (prototyp M35): `BRepOffsetAPI_MakeOffset(face, GeomAbs_Intersection, isOpenResult = !closed)` nad **vlastní rovinnou plochou** `BRepBuilderAPI_MakeFace(gp_Pln, drát, true)` (ze samotného drátu selže i úsečka; uzavřený drát s `isOpenResult = true` dává nesmysl), `Perform(distance)`; hrany výstupu nejsou seřazené (a mohou být `REVERSED`) → vlastní řetězení; `source` z `Generated(vstupní hrana)` (vstupní hrany z `MakeWire.Edge()` jako `face.ts`); spline kusy (`GeomAbs_OffsetCurve`) přes pcurve na vlastní ploše → body → `Geom2dAPI_PointsToBSpline(…, 3, 3, …)` (`Geom2dConvert_ApproxCurve` stupeň 3 nedodrží). `IsDone() = false` → `'operation-failed'`.
- Upřesnění z implementace (úkol 1 M35): výsledek běží ve směru vstupu, uzavřený začíná kusem první vstupní křivky; měřítko tolerance `max(1, |d|, |souřadnice|)`, spoje výstupu do `1e-6 · měřítko`; kružnice s `closed: false` → `'invalid-input'`. OCCT u otevřeného řetězce začínajícího obloukem po směru hodinových ručiček dá stranu opačně (hrana se staví proti směru) → adaptér stranu ověří na výsledku a případně spočítá s `-d`. Řetězení: hrany výstupu v jejich směru (oblouk `ccw` podle `Axis().Direction().Z()`, `OffsetCurve` vzorkováním přes `BRepAdaptor_Curve`), hladově podle koncových bodů. Spline: kusy se stejným `source` sloučené, vzorky do `Geom2dAPI_PointsToBSpline.Init(body, 3, 3, C2, tol)` (konstruktor s pěti argumenty stupeň 3 nedá), uzly do `[0, 1]`, krajní póly přesně do spojů. **Ostrý roh vedle splinu** `GeomAbs_Intersection` nezvládne (vrátí `IsDone()`, ale zahodí hrany) → adaptér použije výsledek `GeomAbs_Arc` (zaoblené jsou pak **všechny** vypouklé rohy řetězce, spoje bez `source`); selže, jen když selže i ten. Smyčka splinu (`d` > poloměr křivosti) dá vloženou úsečku se `source` splinu (není přesná ekvidistanta).

### Kontrakt (platí pro každou implementaci)

Ověřuje ho C++ kontraktová sada nad `OcctKernel` (`server/test/kernel`, port TS sady, [[Rozhodnutí nativního jádra|N26]], [[#Testy]]).

- **Bez výjimek:** v TS zápisu vrací každá metoda `Promise` a chyba je odmítnutý `Promise`, nikdy výjimka při volání. V C++ je chyba `KernelResult` s `KernelError`; výjimka OCCT se uvnitř převede na kód (`server/src/kernel/guarded.hpp`), ven propadne jen `std::bad_alloc` a `AssertionError` (chyba programu, [[Rozhodnutí nativního jádra|N114]]).
- **`makeBox`:** každá složka `origin` je konečné číslo, každá složka `size` je konečné číslo > 0, jinak `'invalid-input'`. Vrací nový handle. Bounding box výsledku **obaluje** `[origin, origin + size]`: `min ≤ origin`, `max ≥ origin + size`, nadsazení nejvýš 1e-6 v každé složce. OCCT `BRepBndLib::Add` rozšiřuje box o toleranci tvaru (~1e-7), adaptér proto použije `BRepBndLib::AddOptimal` bez tolerance tvaru (M7).
- **`makeCylinder`** (M11): každá složka `base` a `axis` konečná, délka `axis` > 1e-9, `radius` a `height` konečné > 0, jinak `'invalid-input'`. Bounding box výsledku odpovídá válci (podstavy `base` a `base + height·â` s poloměrem `radius`) s tolerancí 1e-5 v každé složce.
- **`transform`** (M11): všech 16 prvků konečných a `isRigidMotion(m)`, jinak `'invalid-input'`; neznámý handle → `'unknown-handle'`. Vstupní tvar se nemění a zůstává platný. Bounding box výsledku = bounding box tvaru přemístěného `m` (tolerance 1e-5).
- **`boolean`** (M11): `op` je jedna ze tří hodnot, `targets` i `tools` neprázdné a žádný handle se neopakuje (ani napříč seznamy), jinak `'invalid-input'`; neznámý handle → `'unknown-handle'`. Výsledek bez jediného solidu (prázdný průnik, rozdíl, který cíl celý odebere) a selhání algoritmu → `'operation-failed'`. Vstupy zůstávají platné. `union` = sjednocení všech vstupů, `subtract` = cíle bez nástrojů, `intersect` = společná část cílů a nástrojů.
- **`makeFace`** (M12): `plane` má konečné složky, `xDir` i `normal` jednotkové a navzájem kolmé (`plane.isOrthonormal`, tolerance 1e-9); `outer` neprázdná; každá smyčka je buď jediná `circle` (poloměr konečný > 0), nebo ≥ 1 křivek `line`/`arc` (bez `circle`), kde konec každé křivky leží na začátku další a konec poslední na začátku první (tolerance `1e-7 · max(1, |souřadnice|)`); úsečka a oblouk nenulové délky (`from ≠ to`), oblouk s `|to − center| = |from − center|` (relativně 1e-7) a poloměrem > 1e-9. Jinak `'invalid-input'`. Orientace smyček je libovolná (jádro si ji srovná). Bounding box výsledku = obálka smyčky `outer` v prostoru (tolerance 1e-5; kontraktová sada jen pro roviny s osami rovnoběžnými se souřadnicovými). Plochu, kterou nejde postavit (samoprotínající se smyčka), OCCT hlásí `'operation-failed'`.
- **`profileRegions`** (M30): každá křivka má `id` (neprázdný řetězec, v rámci volání unikátní) a splňuje tvar křivky z `makeFace` (konečná čísla, oblouk se stejnými poloměry, spline s platnými uzly), jinak `'invalid-input'`; pořadí a orientace křivek jsou libovolné. Úsečka nebo oblouk nulové délky (konce do tolerance `makeFace`) a spline, jehož všechny póly leží v jednom bodě, se **vynechá** (není chyba); unikátnost `id` platí i pro vynechané křivky. Kontrola vstupu: `parseProfileRegionsInput` v `profile.hpp` (kopie křivek bez vynechaných, jako `validateFaceInput` pro `makeFace`; v TS `parseProfileRegionsInput(p: unknown): Result<readonly IdentifiedCurve[], readonly string[]>`). Výsledek podle [[12-skicar#Oblasti (profily)]]: konce křivek do tolerance jsou jeden uzel; dvě křivky se společným bodem mimo sdílený koncový uzel (průsečík, dotyk konce s vnitřkem, překryv, i spline křížící sám sebe) → `{ regions: [], crossing: true }`; otevřené čáry nic neohraničují; vnější hranice komponenty se stane dírou nejmenší omezené stěny **jiné** komponenty, která ji obsahuje; oblasti seřazené podle `name`. Kontraktová sada porovnává `name`, `crossing`, počet děr a jejich jména přesně, `area` relativně 1e-6 (spline 1e-3, převzato z TS sady, kde `FakeKernel` počítal spline tessellací s tolerancí `1e-4 · měřítko` – chyba plochy vycházela až 3·10⁻⁴) a body smyček do `1e-7 · max(1, |souřadnice|)`. Tolerance výpočtu jsou věcí implementace (OCCT `Precision::Confusion`); případy na hraně tolerance kontraktová sada nezkouší.
- **`extrude`** (M13): neznámý handle → `'unknown-handle'`; `profile` není plocha (`TopAbs_FACE` – výsledek `makeFace` nebo jeho `transform`) → `'invalid-input'`; každá složka `direction` konečná a jeho délka > 1e-9, `distance` konečné > 0, jinak `'invalid-input'`. Vrací nový handle se solidem, profil zůstává platný. Bounding box výsledku = obálka bbox profilu a bbox profilu posunutého o `d̂ · distance` (tolerance 1e-5; kontraktová sada jen pro plochy v rovinách rovnoběžných se souřadnicovými). Směr rovnoběžný s rovinou plochy se nekontroluje ([[Rozhodnutí noční rychloakce#M13 – Extrude a Revolve|R63]] ⚠). Pozor: směr ležící **přesně** v rovině profilu OCCT nechytí – vznikne solid nulové tloušťky, který projde i `BRepCheck_Analyzer`, takže jádro vrátí úspěch. V tinycad to nenastane, protože směr je vždy normála skici ([[Rozhodnutí noční rychloakce#M13 – Extrude a Revolve|R84]] ⚠).
- **`revolve`** (M13): neznámý handle → `'unknown-handle'`; `profile` není plocha → `'invalid-input'`; složky `axis.origin` a `axis.direction` konečné, délka směru > 1e-9, `angle` konečný a `0 < angle ≤ 2π + 1e-9`, jinak `'invalid-input'`. Profil zůstává platný. Bounding box pro případy kontraktové sady (profil v rovině obsahující osu rovnoběžnou se souřadnicovou osou, úhel začíná na souřadnicové rovině) s tolerancí 1e-5. Osa, která profil protíná, se předem nekontroluje (R63 ⚠); OCCT ji odmítne už v `IsDone()` → `'operation-failed'` (ověřeno testem v `server/test/kernel/sweep_test.cpp`). Osa ležící na hraně profilu je platná (válec).
- **`roles` a `history`** (M14): podle [[#Stav po M14]]. Indexy v rolích a historii jsou platné indexy podtvarů výstupu (a vstupů), vzestupně bez duplicit. **Úplnost historie:** každá plocha každého vstupu je v `history` právě jednou – buď v `modified` (i nezměněná plocha jako identita na svůj index ve výstupu), nebo v `deleted`. Pořadí položek: podle vstupu, pak druhu (`face`, `edge`, `vertex`), pak indexu.
- **`topology`** (M14): neznámý handle → `'unknown-handle'`; počty ploch a hran odpovídají síti (`tessellate`); kvádr má 6 rovinných ploch s normálami ±X, ±Y, ±Z ven z tělesa a bodem roviny na příslušné stěně, 12 hran se dvěma různými sousedními plochami a dvěma vrcholy, `vertexCount` 8.
- **`fillet`, `chamfer`** (M14): neznámý handle → `'unknown-handle'`; `edges` neprázdné, celá čísla v rozsahu hran tvaru, bez duplicit, `radius`/`distance` konečné > 0, jinak `'invalid-input'`. Selhání algoritmu (poloměr větší než sousední plochy, hrana, kterou zaoblit nejde) → `'operation-failed'`, nikdy `'internal'`. Vstup zůstává platný. Bounding box zaobleného nebo zkoseného kvádru (jedna hrana) = bounding box kvádru (tolerance 1e-5).
- **`exportStep`** (M15): `shapes` neprázdné a bez duplicit, jinak `'invalid-input'`; neznámý handle → `'unknown-handle'`; selhání zápisu → `'operation-failed'`. Vstupy zůstávají platné, nevzniká žádný handle. Výsledek je nový buffer (vlastní `ArrayBuffer`, přenositelný), text po oříznutí bílých znaků začíná `ISO-10303-21;` a končí `END-ISO-10303-21;`. Obsah hlavičky (čas, jméno) se nezaručuje, opakované volání nemusí dát stejné bajty.
- **`tessellate`:** `linearDeflection` i `angularDeflection` jsou konečná čísla > 0, jinak `'invalid-input'`. Neznámý handle → `'unknown-handle'`. Každé volání vrací **nové** buffery, nesdílené s jiným voláním, s jiným polem téže sítě ani s vnitřním stavem jádra, takže je volající smí přenést jako transferable. Že opakované volání vrátí stejná data, se **nezaručuje** (OCCT může síť zjemnit).
- **`boundingBox`:** neznámý handle → `'unknown-handle'`. Vrací nový objekt.
- **`release`:**
  - Prázdné pole → nic.
  - Neznámý nebo už uvolněný handle → `'unknown-handle'`. Stejný handle dvakrát v jednom volání → `'invalid-input'`.
  - **Atomický:** při chybě se neuvolní nic. Přísnost odhalí chyby v mark & sweep, které by tolerantní `release` skryl.
- **`liveHandleCount`:** počet vytvořených a neuvolněných handle. Neúspěšná operace žádný handle nevytvoří.
- **Více chyb najednou** (např. neznámý handle i neplatná kvalita): který kód se vrátí, není určeno a sada to netestuje. Dekorátor `CountingKernel` testů regenerace dává přednost chybě z `failNext` ([[Rozhodnutí nativního jádra|N45]]).
- **Izolace:** jádro si neponechává odkaz na vstupní objekty (`origin`, `size`, `base`, `axis`, matice, pole handle) a **čte je při volání** (v C++ jsou vstupy `const&` a `std::span`). Změna vstupu hned po volání (před `await`) výsledek neovlivní. Vrácená data nesdílí paměť s ničím jiným. V TS zápisu platilo: když čtení vstupu selže (vstup mimo typy, např. `null`), je to také odmítnutý `Promise`, ne synchronní výjimka (u `makeFace` a `profileRegions` s kódem `'invalid-input'`, protože jejich kontrola vstupu přijímá `unknown`; jinde `'internal'`); v C++ to typy vstupu nepřipustí.

### Výsledek operace a historie

Aby šlo stavět topologické pojmenování ([[08-topologicke-pojmenovani|08]]), vrací každá operace kromě tvaru i **historii**: co ze vstupu vzniklo, co se změnilo, co zaniklo. V OCCT to odpovídá `BRepBuilderAPI_MakeShape::Generated / Modified / IsDeleted`.

```ts
export interface ShapeResult {
  readonly shape: ShapeHandle;
  readonly history?: ShapeHistory;   // od M14 u operací se vstupními tvary (Stav po M14)
  readonly roles?: Readonly<Record<string, readonly SubShapeIndex[]>>; // pojmenované části, např. { 'face:top': [5] }; od M14 u primitiv, makeFace, extrude, revolve
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

Typy `ShapeHistory`, `HistoryLink` a `SubShapeIndex` vznikají už v M5, aby měl `ShapeResult` konečný tvar. V M5 je žádná implementace nevyplňovala, od M14 je vyplňují obě podle [[#Stav po M14]].

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

/** Strukturální kontrola sítě. Prázdné pole = v pořádku. Pro testy jádra a vývojovou kontrolu v app (render smí z kernel jen typy). */
export function validateMeshData(mesh: MeshData): readonly string[];
```

V klientovi ploché typed arrays, aby šly přes `postMessage` přenést jako transferable bez kopírování (síť přichází z read modelu, [[14-protokol#Read model a sítě]]); v C++ je `MeshData` s vektory v `mesh.hpp`, tamtéž `validateMeshData`. **Každé pole má vlastní `ArrayBuffer`** (a zabírá ho celý). Seznam bufferů k přenosu tak nemá duplicity, se kterými by `postMessage` skončil `DataCloneError`.

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

- Neočekávaná výjimka uvnitř implementace (výjimka OCCT `Standard_Failure`, jiná výjimka) se převede na `'internal'`; `std::bad_alloc` a `AssertionError` propadnou ([[Rozhodnutí nativního jádra|N114]]). V C++ je chyba `KernelError { code, message }` a `enum class KernelErrorCode { InvalidInput, OperationFailed, UnknownHandle, Internal }` (`errors.hpp`).
- Regenerace chybu jádra převede na status featury `KERNEL` a pokračuje ([[07-regenerace#Stav featury]]); výjimka z builderu, která z jádra nepochází, je chyba programu ([[Q043 Výjimka builderu mimo jádro|Q043]]). Pád jádra se ztrátou handle ([[Q049 Pád jádra během regenerace|Q049]]) na serveru nenastává ([[Rozhodnutí nativního jádra|N40]]).

## Adaptér `OcctKernel`

Architektura adaptéru `kernel-occt` v prohlížeči (worker, `ready`, tessellace ve workeru, Vite, výjimky a trapy WASM): [[06-geometricke-jadro v prohlížeči]].

```
regenerace / sezení (jeden volající, N13, N54)
        │  ModelingKernel / GeometryKernel (kernel.hpp)
        ▼
OcctKernel (occt_kernel.hpp) ── Impl: ShapeTable  Map<ShapeHandle, ShapeEntry> (shape_table.hpp)
        │  operace v samostatných souborech: primitives, transform, boolean, face, regions,
        │  sweep, dressup, query, topology, history, tessellate, step (server/src/kernel/*.cpp)
        ▼
OCCT 8.0.1 (nativní knihovny TK*)
```

- `OcctKernel` je jediná veřejná třída; tabulka tvarů a všechny typy OCCT jsou v soukromém `Impl` (pimpl, [[Rozhodnutí nativního jádra|N14]]). Zničení jádra uvolní všechny tvary.
- Každá veřejná metoda běží v `try` a cokoli vyhozeného převede na `KernelError` (`guarded.hpp`: `KernelFailure` nese kód očekávané chyby, `Standard_Failure` a jiné výjimky → `'internal'`); `std::bad_alloc` a `AssertionError` propadnou ([[Rozhodnutí nativního jádra|N114]]). Operace, které běžně selhávají (boolean, fillet), kontrolují `IsDone()` samy a vrací `'operation-failed'`.
- Instance není bezpečná pro vlákna; volání serializuje vrstva sezení ([[Rozhodnutí nativního jádra|N13]], [[14-protokol#Vlákna a zámky serveru]]). Dlouhé operace (fillet) blokují další volání téhož dokumentu.
- **Mapy podtvarů:** `TopExp::MapShapes` přímo (WASM build ho neměl). `SubShapeIndex` = pozice v mapě minus 1.
- Algoritmy níže jsou port TS adaptéru `kernel-occt` (stejné kroky, stejné role a historie); odchylky nativního OCCT jsou uvedené u jednotlivých odrážek.

### Společný 2D základ `tinycad_occt2d`

Od [[M50-occt2d-a-vrstva-rpc|M50]] ([[Rozhodnutí nativního jádra|N77, N154]]) mají `tinycad_kernel` (rovinná plocha, oblasti skici) a `tinycad_geometry` (2D geometrie skicáře za `GeometryService`) jeden 2D základ nad OCCT, knihovnu `tinycad_occt2d` v `server/src/occt2d`. Dřív byl stejný kód dvakrát (`kernel/curves2d`, `geometry/geom2d` a dvě kopie kontroly křivek).

| Hlavička | Obsah |
|---|---|
| `tinycad/occt2d/curves.hpp` | převody `core::Curve2` → Geom2d (`boundedCurve`, `splineCurve`, `circleCurve`), zpět `splineOf`, `compressKnots`; 2D pomůcky `dist`, `samePoint` (tolerance `kPointTolerance = 1e-7` relativně), `angleAround`, `onCircle`, `wrap`, `arcSweep`, `scaleOf`, `counterClockwise`, `startOf`/`endOf` |
| `tinycad/occt2d/boxes.hpp` | obálky křivek `Box` (`boxOf`, `unionOf`, `boxesOverlap`, `inBox`) a předfiltr dvojic `overlappingPairs` (zametání podle x) |
| `tinycad/occt2d/curve_checks.hpp` | kontrola jedné vstupní křivky `readCurve` s pravidly `CurveRules { idRequired, skipZeroLength }` → `Ok` / `Skip` / `Bad` a texty problémů s cestou; `knotsProblem` (sevřený uzlový vektor). Konstanty `kRadiusTolerance`, `kMaxSplineDegree = 25`, `kMinArcRadius` jsou jen tady. |

- Knihovna je **interní**: její hlavičky nesou typy OCCT (`Handle(Geom2d_Curve)`), proto ji linkují jen `tinycad_kernel` a `tinycad_geometry`, a to `PRIVATE`. Veřejné hlavičky domény typy OCCT dál neznají ([[0030-nativni-jadro-pres-grpc|ADR 0030]]).
- Kontroly vstupu zůstávají u volajících: `kernel/profile.cpp` (`validateFaceInput`, `parseProfileRegionsInput`) sbírá problémy do seznamu textů, `geometry/validate.cpp` do `Problems`, který je hodí jako `Failure 'invalid-input'`; jednu křivku obě kontrolují přes `readCurve`.
- Mimo základ zůstávají algoritmy, které kopiemi nejsou: oblasti (`kernel/regions.cpp`) a průsečíky (`geometry/intersections.cpp`).

### Tessellace v adaptéru

- `BRepMesh_IncrementalMesh(shape, linearDeflection, false, angularDeflection, false)`: absolutní průhyb, bez paralelismu (jeden volající, N13).
- Plochy v pořadí mapy podtvarů (`SubShapeIndex` = pozice). Každá plocha má **vlastní vrcholy** (žádné sdílení mezi plochami), aby šly normály ostrých hran a `faceRanges`. Uzly triangulace se transformují `TopLoc_Location` plochy.
- Plocha s orientací `TopAbs_REVERSED`: prohodí se pořadí dvou vrcholů každého trojúhelníku a otočí normály, aby trojúhelníky byly CCW při pohledu zvenku.
- Normály z OCCT: `BRepLib_ToolTriangulatedShape.ComputeNormals(face, triangulation)` spočte normálu skutečné plochy v UV bodu každého uzlu (`GeomLib::NormEstim`); kde normála plochy není definovaná (pól koule), OCCT sám vezme průměr normál trojúhelníků v uzlu. Normály uloží do triangulace (`Poly_Triangulation.Normal(i)`) v souřadnicích plochy **bez** lokace a **bez** ohledu na orientaci plochy. Adaptér je proto otočí lokací (`gp_Dir.Transform(trsf)`, jen rotační část) a u plochy `TopAbs_REVERSED` obrátí. Nahrazuje dřívější vlastní průměr normál trojúhelníků (M11, [[Rozhodnutí noční rychloakce#M11 – Další entity|R21]]), který na švu a okraji pláště válce ujížděl o polovinu úhlového kroku; změna podle přání co nejvíc používat OCCT ([[Q088 Geometrie skici v TypeScriptu nebo v OCCT|Q088]]). Plocha, jejíž triangulace normály nedostane (`HasNormals()` je `false`), se vynechá jako plocha bez trojúhelníků.
- Lokace se aplikují přes `gp_Trsf.Transforms(x, y, z)` (bez nového objektu OCCT na uzel). **Zrcadlící lokace** (`gp_Trsf.IsNegative()`) by otočila navinutí; nevznikne, protože `transform` přijímá jen tuhé pohyby (M11).
- Hrany v pořadí mapy podtvarů. Polyline z `BRep_Tool.PolygonOnTriangulation(edge, loc)`: OCCT vybere první reprezentaci hrany na triangulaci sousední plochy a vrátí polygon, tu triangulaci a složenou lokaci. Uzly polygonu jsou indexy do vrácené triangulace, transformují se vrácenou lokací. Degenerovaná hrana, hrana bez polygonu nebo s méně než 2 body se do `edgeRanges` nezapíše (jako plocha bez trojúhelníků).
- Chybějící triangulace nebo polygon je prázdný `Handle` (`IsNull()`); adaptér to testuje explicitně.
- Výsledek se kopíruje do nových vektorů `MeshData` ([[#Síť pro vykreslení]]). Kód `server/src/kernel/tessellate.cpp`.

### Modelovací operace v adaptéru (M11)

- **Válec:** `BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(base), gp_Dir(axis)), radius, height)`. Má 3 plochy (plášť, dvě podstavy) a 3 hrany (dvě kružnice a šev).
- **Transformace:** `gp_Trsf.SetValues(a11 … a34)` po řádcích (`a_rc = m[c*4 + r]`, `Mat4` je po sloupcích) a `BRepBuilderAPI_Transform(shape, trsf, false)`. Tuhý pohyb jen nastaví lokaci, geometrie (`TShape`) se nekopíruje a sdílí s původním tvarem; tessellace lokaci ploch aplikuje.
- **Boolean:** prázdný konstruktor `BRepAlgoAPI_Fuse | Cut | Common`, `SetArguments(cíle)`, `SetTools(nástroje)` (seznamy `TopTools_ListOfShape`), `Build()`. `HasErrors()` → `'operation-failed'`; výsledek bez solidu (`TopExp_Explorer(výsledek, TopAbs_SOLID).More()` je `false`) → `'operation-failed'`.

### Rovinná plocha v adaptéru (M12)

- Rovina `gp_Ax3(gp_Pnt(origin), gp_Dir(normal), gp_Dir(xDir))`, `gp_Pln(ax3)`; bod roviny `(x, y)` → `origin + x·xDir + y·yDir` (`plane.toWorld` z `core`).
- Hrany: úsečka `BRepBuilderAPI_MakeEdge(gp_Pnt, gp_Pnt)`; oblouk `BRepBuilderAPI_MakeEdge(gp_Circ, P1, P2)` s `gp_Circ(gp_Ax2(střed, normal, xDir), r)` – kružnice v OCCT běží proti směru hodinových ručiček kolem `normal`, takže pro `ccw: false` se body prohodí; kružnice `BRepBuilderAPI_MakeEdge(gp_Circ)`.
- Smyčka `BRepBuilderAPI_MakeWire` (`Add` po hranách, `IsDone()` jinak `'operation-failed'`); plocha `BRepBuilderAPI_MakeFace(gp_Pln, outerWire, true)`, díry `Add(holeWire)`, pak `ShapeFix_Face(face).FixOrientation()` (srovná orientaci děr; samotné `Perform()` to nestačí, ověřeno v M12) a `BRepCheck_Analyzer(face).IsValid()` jinak `'operation-failed'`. Objekty OCCT drží hodnoty a `Handle` (RAII).

- **B-spline (M29):** `Geom_BSplineCurve(Poles: NCollection_Array1_gp_Pnt, Knots: NCollection_Array1_double, Multiplicities: NCollection_Array1_int, Degree)` ve 3D (řídicí body převedené `plane.toWorld`), uzly zkomprimované na unikátní hodnoty a násobnosti (`compressKnots`, port z TS), hrana `BRepBuilderAPI_MakeEdge(Geom_Curve)`. Adaptér nic nevzorkuje ani neaproximuje; platnost hlídá stávající `BRepCheck_Analyzer` (spline křížící jinou stranu → `'operation-failed'`). Měření plochy v testech potřebuje přesnou variantu `BRepGProp::SurfaceProperties(shape, props, 1e-9, false)` – výchozí se u plochy se splinem plete o ~2e-4 relativně.

### Oblasti skici v adaptéru (M30)

`server/src/kernel/regions.cpp`, port `kernel-occt/regions.ts` ([[Rozhodnutí nativního jádra|N29]]). Cesta zvolená prototypem ([[M30-geometrie-skici-v-occt#Průběh stopy|M30]]): WASM build nevázal `BOPAlgo_Builder`, `BOPAlgo_Tools`, `IntAna2d`, `GCE2d` ani klasifikátory bodu v ploše (`BRepClass_FaceClassifier`, `BRepTopAdaptor_FClass2d`); `BRepAlgoAPI_Splitter` nepozná spline křížící sám sebe, visící hranu nechá v ploše a trojúhelník dotýkající se obdélníku rohem udělá dírou. Proto algoritmus kontraktu (spec 12 *Oblasti (profily)*) s geometrií z OCCT:

- Vstup zkontroluje `parseProfileRegionsInput` (`profile.hpp`). 2D křivky `GC_MakeSegment2d`, `GC_MakeArcOfCircle2d` (oblouk vždy proti směru, `ccw: false` se otočí), `GC_MakeCircle2d`, `Geom2d_BSplineCurve` (uzly přes `compressKnots`). Tolerance `tol = 1e-7 · max(1, největší |souřadnice|)` pro uzly i průsečíky.
- **Křížení:** `Geom2dAPI_InterCurveCurve(c1, c2, tol)` jen pro dvojice s překrytými obálkami (řazení podle x); `NbSegments() > 0` (překryv) nebo bod průsečíku dál než `1e3 · tol` od sdíleného uzlu → `crossing`. Spline proti sobě `Geom2dAPI_InterCurveCurve(c, tol)`; u uzavřeného splinu bod v jeho uzlu jen tehdy, když jím křivka prochází i uvnitř (promítnutí uzlu). Průsečíky nevrací parametry, rozhoduje poloha bodu.
- **Stěny:** polohrany s úhlem tečny a znaménkovou křivostí z `D1`/`D2` (zápis do předem vytvořených `gp_Pnt2d`/`gp_Vec2d`, bez alokace v cyklu), `next(e)` jako TS fake do M46. Znaménková plocha cyklu = součet Greenových integrálů ∮(x dy − y dx)/2 hran (5bodový Gauss–Legendre nad `D1`, spline po úsecích mezi uzly, oblouk 16 kusů na otáčku); ne `BRepGProp` nad plochou z `MakeFace`, který u sevřené smyčky dává jiný obsah. Osamocená kružnice πr².
- **Díry:** bod vnější hranice v kandidátní stěně: obálka, pak parita průsečíků paprsku (`Geom2d_Line` + `InterCurveCurve`). Paprsek pod iracionálním úhlem; když projde uzlem nebo se křivky jen dotkne (sin úhlu ≤ 1e-3), další směr posunutý o zlatý úhel, nejvýš 8 pokusů.
- **Výstup:** smyčky ze **vstupních** křivek (souřadnice beze změny), zpětná polohrana = úsečka s prohozenými konci, oblouk `ccw: false`, spline s obrácenými póly a uzly `a + b − k`. Oblasti podle `name`, výsledek zmrazený. Mřížka 840 úseček ~50 ms, 1860 ~110 ms (měřeno ve WASM v M30).
- Pro [[Q093 Oblasti z křížících se křivek|Q093]] (oblasti z křížících se křivek) je kandidát `BRepAlgoAPI_Splitter`: křivky v průsečících rozdělí sám a jména kusů dá historie.

### Tažení v adaptéru (M13)

- Typ profilu: `shape.ShapeType()` musí být `TopAbs_FACE`, jinak `'invalid-input'` (kontrola před stavbou).
- **Hranol:** `BRepPrimAPI_MakePrism(face, gp_Vec(d̂ · distance), false, true)` (bez kopie, kanonizace ploch). `IsDone()`, výsledek obsahuje solid (`TopExp_Explorer(…, TopAbs_SOLID).More()`) a `BRepCheck_Analyzer(výsledek).IsValid()`, jinak `'operation-failed'`.
- **Rotace:** `gp_Ax1(gp_Pnt(origin), gp_Dir(direction))`, `BRepPrimAPI_MakeRevol(face, ax1, angle, false)`; stejné kontroly jako u hranolu.
- `FirstShape()`/`LastShape()` (start a konec) a `Generated(hrana)` (boční plochy) algoritmus umí; využije je M14 pro `roles` a historii. Objekty OCCT drží hodnoty a `Handle` (RAII).

### Historie, role a topologie v adaptéru (M14)

- **Historie** jedním pomocníkem `collectHistory(maker, inputs: ShapeEntry[], output: ShapeEntry)` pro každý algoritmus s `Modified/Generated/IsDeleted` (`BRepBuilderAPI_MakeShape`, `BRepAlgoAPI_BuilderAlgo`, `BRepFilletAPI_*`): pro každou plochu `f` každého vstupu `IsDeleted(f)` → `deleted`; jinak `Modified(f)` → indexy ploch výstupu přes `IsSame`; prázdný seznam a `f` je ve výstupu (`IsSame`) → identita; prázdný a ve výstupu není → `deleted`. `Generated(s)` pro plochy, hrany a vrcholy vstupu → jen podtvary typu plocha, které ve výstupu jsou. Hledání plochy výstupu přes mapu podtvarů s `TopTools_ShapeMapHasher` (`FindIndex`), ne lineární `IsSame`. Kód `server/src/kernel/history.cpp` (`HistoryCollector`).
- Boolean: `SetToFillHistory(true)` je výchozí; `Modified` cílových i nástrojových ploch. Transformace: `BRepBuilderAPI_Transform` (`Modified` vrátí přemístěnou plochu).
- **Role kvádru** z `BRepPrimAPI_MakeBox` přes tabulku: `TopFace` → `face:top`, `BottomFace` → `face:bottom`, `LeftFace` (YMin) → `face:front`, `RightFace` (YMax) → `face:back`, `BackFace` (XMin) → `face:left`, `FrontFace` (XMax) → `face:right`; index přes `IsSame` v mapě ploch. **Válec:** `Face()` z `BRepPrimAPI_MakeOneAxis` → `face:side`; ze dvou rovinných ploch je `face:bottom` ta, jejíž bod roviny má menší průmět na osu.
- **`makeFace`:** hrany se staví s id křivky; `BRepBuilderAPI_MakeWire` při slučování vrcholů hrany **kopíruje**, proto se k id ukládá hrana z `MakeWire.Edge()` po každém `Add` (ne postavená hrana); po `ShapeFix_Face` se každá hrana výsledku přiřadí přes `IsSame` k těmto hranám ([[Rozhodnutí noční rychloakce#M14 – Topologické pojmenování|R119]]). `ShapeEntry` dostane `edgeRoles: ReadonlyMap<number, string>` (index hrany → id); `transform` ji přenese přes `Modified` hran (pořadí mapy podtvarů se tuhým pohybem nemění).
- **Hranol a rotace:** `FirstShape()`/`LastShape()` → `face:start`/`face:end`, jen když je `IsSame` ve výsledku; `Generated(hrana profilu)` → `face:side:<id>` pro hrany s rolí; historie přes `collectHistory` (vstup 0 = profil). Rotace o 2π vrací pro hranu kolmou na osu prázdné `Generated` a mezikruží nemá šev: boční plocha se pak hledá náhradně mezi plochami, které nemá žádná jiná role, jako plocha ohraničená všemi kružnicemi z `Generated(vrchol hrany)` ([[Rozhodnutí noční rychloakce#M14 – Topologické pojmenování|R118]] ⚠); historie zůstává přesně podle OCCT. Hrana profilu ležící na ose plochu nevytvoří, takže role nemá.
- **Topologie:** typ plochy `BRepAdaptor_Surface(face).GetType()` (`GeomAbs_Plane` → `'plane'`, `Cylinder`, `Cone`, `Sphere`, `Torus`, jinak `'other'`); rovina z `Plane()` (`Location`, `Axis().Direction()`); normála plochy je `XDir × YDir` rámce, tedy u levotočivého rámce (`gp_Pln.Direct()` = false) opačná než `Axis()` (R119), a u plochy s orientací `TopAbs_REVERSED` ještě obrácená; sousednost hrana → plochy přes `TopExp_Explorer(plocha, TopAbs_EDGE)` a `IsSame` v mapě hran; vrcholy hrany přes `TopExp_Explorer(hrana, TopAbs_VERTEX)`; střed `BRepAdaptor_Curve` v `(First + Last) / 2`. Topologie obsahuje i degenerované hrany (vrchol kužele, pól koule), které síť nemá, takže počet hran topologie se může lišit od počtu hran v `edgeRanges`; indexy sdílí. Sousednost hran a ploch jednou mapou `TopExp::MapShapesAndAncestors` (WASM build ji neměl a počítal přes explorer, O(F · E)); kód `topology.cpp`.
- **Zaoblení a zkosení:** `BRepFilletAPI_MakeFillet(shape)`, `Add(radius, TopoDS.Edge(hrana))` pro každou hranu, `Build()`; `BRepFilletAPI_MakeChamfer(shape)`, `Add(distance, hrana)`. Po každém `Add` se ověří `maker.Contour(hrana) !== 0`. `Add` je `void` a hranu, kterou OCCT nezpracuje (např. šev válce), jinak tiše vynechá. Taková hrana → `'operation-failed'` se zprávou `fillet: OCCT did not accept edge <i>` (resp. `chamfer: …`), dřív se zaoblily jen ostatní hrany a hlásil se úspěch ([[M19.1-opravy-z-revize|M19.1]]). Výjimka OCCT z `Build`/`Shape`, `!IsDone()`, výsledek bez solidu nebo neplatný (`BRepCheck_Analyzer`) → `'operation-failed'` se zprávou; `std::bad_alloc` a `AssertionError` propadnou ([[Rozhodnutí nativního jádra|N114]]). Fillet a Chamfer v regeneraci sdílí `buildDressup` ([[Rozhodnutí nativního jádra|N111]]). Historie přes `collectHistory`. Objekty OCCT drží hodnoty a `Handle` (RAII).

### Export STEP v adaptéru (M15)

- Tvar k zápisu: jeden handle přímo jeho tvar, víc → `TopoDS_Compound` (`TopoDS_Builder.MakeCompound`, `Add` pro každý tvar v pořadí `shapes`).
- `STEPControl_Writer`: `Transfer(tvar, STEPControl_AsIs)` a `Write(cesta)`; status jiný než `IFSelect_RetDone` → `'operation-failed'`; výjimka OCCT z `Transfer`/`Write` také → `'operation-failed'` (se zprávou výjimky). Jednotky výchozí (`write.step.unit` = mm, souhlasí s [[01-architektura#Souřadnice a jednotky]]); soubor v mm a schéma AP214 ověřené testem v M15.
- Writer umí psát jen do souboru: dočasný soubor `<temp_directory_path>/tinycad-export-<pid>-<n>.step`, přečtený do `std::string` a smazaný RAII objektem i po chybě. `STEPControl_Writer` má globální stav, proto zápis drží zámek celého procesu ([[14-protokol#Vlákna a zámky serveru]]). Kód `step.cpp`.
- Klient dostane bajty přes `SessionService` ([[14-protokol]]).

Volba WASM buildu OCCT (spike v M7, [[Q012 Volba WASM buildu OCCT|Q012]], [[0013-replicad-opencascadejs|ADR 0013]]) a TS `FakeKernel`: [[06-geometricke-jadro v prohlížeči]].

## Testy

C++ testy v `server/test/kernel/` (spustitelný `tinycad_kernel_tests`, GoogleTest) nad `OcctKernel`: port TS kontraktové sady `kernel/testing.ts` a testů adaptéru `test/unit/kernel-occt` ([[Rozhodnutí nativního jádra|N26]]). Původní rozpis TS testů: [[06-geometricke-jadro v prohlížeči#Testy]].

- **Kontraktová sada** pokrývá každou odrážku [[#Kontrakt (platí pro každou implementaci)|kontraktu]] po souborech: `lifecycle_test.cpp` (nové handle, nikdy znovu použité, kódy chyb, atomicita `release`, `liveHandleCount`), `modeling_test.cpp` (kvádr, M11 válec, `transform`, `boolean`), `face_test.cpp` (M12, B-spline M29), `sweep_test.cpp` (M13), `topology_test.cpp`, `history_test.cpp`, `dressup_test.cpp` (M14), `step_test.cpp` (M15 včetně zpětného načtení `STEPControl_Reader`, objem a bbox), `regions_test.cpp` (M30), `tessellate_test.cpp` a `mesh_test.cpp` (síť projde `validateMeshData`, nové buffery, kvádr 6 ploch a 12 hran s normálami ven; `validateMeshData` a `isRigidMotion` po pravidlech), `profile_test.cpp` (`validateFaceInput`, `parseProfileRegionsInput`), `guarded_test.cpp` (převod výjimek na kódy, N114).
- Případy a tolerance jsou stejné jako v TS sadě (bbox 1e-5, objemy ze sítě do 1 %, úplnost historie, role kvádru a válce, akceptace M12–M15 z adaptéru).
- **Paměť** (`memory_test.cpp`, [[Rozhodnutí nativního jádra|N31]]): 200 kol modelování a uvolnění, růst RSS po zahřátí nejvýš 20 MB a `liveHandleCount` 0. Q054 a Q055 byly specifické pro WASM build.
- 2D geometrie skicáře (`tinycad_geometry`) se testuje sdílenými případy `geometry` (`server/test/shared-cases/geometry_cases_test.cpp`) a přes `GeometryService` ([[14-protokol#Testy]]).
- Chování jádra v celé sestavě ověřují sdílené případy `regen` ([[07-regenerace#Testy]], [[13-testovani]]).
- Klient: testy typů a pomůcek modulu `kernel` v `test/unit/kernel/` (`validateMeshData`, `kernelErrorCode`).

## Otevřené otázky

Otázky jsou samostatné poznámky v `60-otazky/` a odkazují sem. Novou otázku založ šablonou *Otázka*.

![[otazky.base#Otázky k této poznámce]]
