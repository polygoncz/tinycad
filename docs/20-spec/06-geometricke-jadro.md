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
  - "[[M12-skicar]]"
  - "[[M13-extrude-revolve]]"
  - "[[M14-topologicke-pojmenovani]]"
  - "[[M15-export-a-dokonceni]]"
  - "[[M16-vlastni-occt-build]]"
tags:
  - spec
created: 2026-10-12
updated: 2026-10-15
---
# 06 – `kernel` a `kernel-occt`: geometrické jádro

> **Pojmy:** [[Geometrické jádro]], [[Handle tvaru]], [[Port a adaptér]]  
> **Rozhodnutí:** [[0002-occt-wasm-ve-workeru]], [[0011-programovani-proti-rozhranim]], [[Q039 Chyby jádra přes hranici workeru|Q039]]  
> **Milník:** [[M05-kernel-port]], [[M07-kernel-occt]], [[M11-dalsi-entity]]

Geometrické jádro je za **portem** `GeometryKernel`. Doména (`regen`) zná jen rozhraní. Konkrétní implementace:

- **OCCT** (`kernel-occt`): OpenCascade ve WASM, běží ve Web Workeru ([[0002-occt-wasm-ve-workeru|ADR 0002]]). Tovární funkce `createOcctKernel(): Promise<GeometryKernel & Disposable & { onDisconnected }>` (počká na start workeru) – M7.
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

### Kontrakt (platí pro každou implementaci)

Ověřuje ho kontraktová sada ([[#Testy]]), spuštěná pro `FakeKernel` v M5 a pro OCCT v M7.

- **Asynchronní a bez synchronních výjimek:** každá metoda vrací `Promise`. Chyba je vždy odmítnutý `Promise`, nikdy výjimka při volání.
- **`makeBox`:** každá složka `origin` je konečné číslo, každá složka `size` je konečné číslo > 0, jinak `'invalid-input'`. Vrací nový handle. Bounding box výsledku **obaluje** `[origin, origin + size]`: `min ≤ origin`, `max ≥ origin + size`, nadsazení nejvýš 1e-6 v každé složce. OCCT `BRepBndLib::Add` rozšiřuje box o toleranci tvaru (~1e-7), adaptér proto použije `BRepBndLib::AddOptimal` bez tolerance tvaru (M7).
- **`makeCylinder`** (M11): každá složka `base` a `axis` konečná, délka `axis` > 1e-9, `radius` a `height` konečné > 0, jinak `'invalid-input'`. Bounding box výsledku odpovídá válci (podstavy `base` a `base + height·â` s poloměrem `radius`) s tolerancí 1e-5 v každé složce.
- **`transform`** (M11): všech 16 prvků konečných a `isRigidMotion(m)`, jinak `'invalid-input'`; neznámý handle → `'unknown-handle'`. Vstupní tvar se nemění a zůstává platný. Bounding box výsledku = bounding box tvaru přemístěného `m` (tolerance 1e-5).
- **`boolean`** (M11): `op` je jedna ze tří hodnot, `targets` i `tools` neprázdné a žádný handle se neopakuje (ani napříč seznamy), jinak `'invalid-input'`; neznámý handle → `'unknown-handle'`. Výsledek bez jediného solidu (prázdný průnik, rozdíl, který cíl celý odebere) a selhání algoritmu → `'operation-failed'`. Vstupy zůstávají platné. `union` = sjednocení všech vstupů, `subtract` = cíle bez nástrojů, `intersect` = společná část cílů a nástrojů.
- **`makeFace`** (M12): `plane` má konečné složky, `xDir` i `normal` jednotkové a navzájem kolmé (`plane.isOrthonormal`, tolerance 1e-9); `outer` neprázdná; každá smyčka je buď jediná `circle` (poloměr konečný > 0), nebo ≥ 1 křivek `line`/`arc` (bez `circle`), kde konec každé křivky leží na začátku další a konec poslední na začátku první (tolerance `1e-7 · max(1, |souřadnice|)`); úsečka a oblouk nenulové délky (`from ≠ to`), oblouk s `|to − center| = |from − center|` (relativně 1e-7) a poloměrem > 1e-9. Jinak `'invalid-input'`. Orientace smyček je libovolná (jádro si ji srovná). Bounding box výsledku = obálka smyčky `outer` v prostoru (tolerance 1e-5; kontraktová sada jen pro roviny s osami rovnoběžnými se souřadnicovými). Plochu, kterou nejde postavit (samoprotínající se smyčka), OCCT hlásí `'operation-failed'`.
- **`extrude`** (M13): neznámý handle → `'unknown-handle'`; `profile` není plocha (`TopAbs_FACE` – výsledek `makeFace` nebo jeho `transform`) → `'invalid-input'`; každá složka `direction` konečná a jeho délka > 1e-9, `distance` konečné > 0, jinak `'invalid-input'`. Vrací nový handle se solidem, profil zůstává platný. Bounding box výsledku = obálka bbox profilu a bbox profilu posunutého o `d̂ · distance` (tolerance 1e-5; kontraktová sada jen pro plochy v rovinách rovnoběžných se souřadnicovými). Směr rovnoběžný s rovinou plochy se nekontroluje ([[Rozhodnutí noční rychloakce#M13 – Extrude a Revolve|R63]] ⚠). Pozor: směr ležící **přesně** v rovině profilu OCCT nechytí – vznikne solid nulové tloušťky, který projde i `BRepCheck_Analyzer`, takže jádro vrátí úspěch. V tinycad to nenastane, protože směr je vždy normála skici ([[Rozhodnutí noční rychloakce#M13 – Extrude a Revolve|R84]] ⚠).
- **`revolve`** (M13): neznámý handle → `'unknown-handle'`; `profile` není plocha → `'invalid-input'`; složky `axis.origin` a `axis.direction` konečné, délka směru > 1e-9, `angle` konečný a `0 < angle ≤ 2π + 1e-9`, jinak `'invalid-input'`. Profil zůstává platný. Bounding box pro případy kontraktové sady (profil v rovině obsahující osu rovnoběžnou se souřadnicovou osou, úhel začíná na souřadnicové rovině) s tolerancí 1e-5. Osa, která profil protíná, se předem nekontroluje (R63 ⚠); OCCT ji odmítne už v `IsDone()` → `'operation-failed'` (ověřeno testem v `kernel-occt/occt-sweep.test.ts`). Osa ležící na hraně profilu je platná (válec).
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
- **Více chyb najednou** (např. neznámý handle i neplatná kvalita): který kód se vrátí, není určeno a sada to netestuje. `FakeKernel` dává přednost chybě z `failNext`.
- **Izolace:** jádro si neponechává odkaz na vstupní objekty (`origin`, `size`, `base`, `axis`, matice, pole handle) a **čte je synchronně při volání**, jako by je klonoval `postMessage`. Změna vstupu hned po volání (před `await`) výsledek neovlivní. Vrácená data nesdílí paměť s ničím jiným. Když čtení vstupu selže (vstup mimo typy, např. `null`), je to také odmítnutý `Promise`, ne synchronní výjimka (u `makeFace` s kódem `'invalid-input'`, protože `validateFaceInput` přijímá `unknown`; jinde `'internal'`).

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
- Výsledek se kopíruje do nových typed arrays, každé s vlastním `ArrayBuffer` ([[#Síť pro vykreslení]]).

### Modelovací operace v adaptéru (M11)

- **Válec:** `BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(base), gp_Dir(axis)), radius, height)`. Má 3 plochy (plášť, dvě podstavy) a 3 hrany (dvě kružnice a šev).
- **Transformace:** `gp_Trsf.SetValues(a11 … a34)` po řádcích (`a_rc = m[c*4 + r]`, `Mat4` je po sloupcích) a `BRepBuilderAPI_Transform(shape, trsf, false)`. Tuhý pohyb jen nastaví lokaci, geometrie (`TShape`) se nekopíruje a sdílí s původním tvarem; tessellace lokaci ploch aplikuje.
- **Boolean:** prázdný konstruktor `BRepAlgoAPI_Fuse | Cut | Common`, `SetArguments(cíle)`, `SetTools(nástroje)` (seznamy `NCollection_List_TopoDS_Shape`; `Append` vrací nový obal `TopoDS_Shape`, který adaptér smaže), `Build()`. `HasErrors()` → `'operation-failed'`; výsledek bez solidu (`TopExp_Explorer(výsledek, TopAbs_SOLID).More()` je `false`) → `'operation-failed'`.

### Rovinná plocha v adaptéru (M12)

- Rovina `gp_Ax3(gp_Pnt(origin), gp_Dir(normal), gp_Dir(xDir))`, `gp_Pln(ax3)`; bod roviny `(x, y)` → `origin + x·xDir + y·yDir` (`plane.toWorld` z `core`).
- Hrany: úsečka `BRepBuilderAPI_MakeEdge(gp_Pnt, gp_Pnt)`; oblouk `BRepBuilderAPI_MakeEdge(gp_Circ, P1, P2)` s `gp_Circ(gp_Ax2(střed, normal, xDir), r)` – kružnice v OCCT běží proti směru hodinových ručiček kolem `normal`, takže pro `ccw: false` se body prohodí; kružnice `BRepBuilderAPI_MakeEdge(gp_Circ)`.
- Smyčka `BRepBuilderAPI_MakeWire` (`Add` po hranách, `IsDone()` jinak `'operation-failed'`); plocha `BRepBuilderAPI_MakeFace(gp_Pln, outerWire, true)`, díry `Add(holeWire)`, pak `ShapeFix_Face(face).FixOrientation()` (srovná orientaci děr; samotné `Perform()` to nestačí, ověřeno v M12) a `BRepCheck_Analyzer(face).IsValid()` jinak `'operation-failed'`. Všechny objekty OCCT přes `using`.

- **B-spline (M29):** `Geom_BSplineCurve(Poles: NCollection_Array1_gp_Pnt, Knots: NCollection_Array1_double, Multiplicities: NCollection_Array1_int, Degree)` ve 3D (řídicí body převedené `plane.toWorld`, pole s dolní mezí 0 – OCCT je přijme), uzly zkomprimované na unikátní hodnoty a násobnosti (build neexportuje `BSplCLib`), hrana `BRepBuilderAPI_MakeEdge(Geom_Curve)`. Adaptér nic nevzorkuje ani neaproximuje; platnost hlídá stávající `BRepCheck_Analyzer` (spline křížící jinou stranu → `'operation-failed'`). Měření plochy v testech potřebuje přesnou variantu `BRepGProp.SurfaceProperties(shape, props, 1e-9, false)` – výchozí se u plochy se splinem plete o ~2e-4 relativně.

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

## Otevřené otázky

Otázky jsou samostatné poznámky v `60-otazky/` a odkazují sem. Novou otázku založ šablonou *Otázka*.

![[otazky.base#Otázky k této poznámce]]
