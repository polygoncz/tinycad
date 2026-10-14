---
type: milestone
status: done
order: 17
aliases:
  - M17
  - M17 Kamera a view cube
modules:
  - core
  - render
  - app
  - ui
specs:
  - "[[02-core]]"
  - "[[09-vykreslovani]]"
  - "[[11-ui]]"
depends_on:
  - "[[M15-export-a-dokonceni]]"
started: 2026-10-14
finished: 2026-10-14
tags:
  - milnik
created: 2026-10-14
updated: 2026-10-14
---
# M17 – Kamera a view cube

**Cíl:** kamera, která nikdy neořízne model, a view cube jako v Onshape (klik na stěnu, hranu nebo roh, tažení, šipky o 90°, animované přechody).

**Specifikace:** [[09-vykreslovani#Kamera]], [[09-vykreslovani#View cube]], [[0019-vlastni-ovladani-kamery|ADR 0019]]

**Navazuje na:** [[M15-export-a-dokonceni|M15]] (první milník po noční rychloakci; [[M16-vlastni-occt-build|M16]] se nedělá)

## Proč

- **Ořezávání:** `near`/`far` se dnes počítají jen ve `fitAll`/`setView` z koule kolem cíle ([[09-vykreslovani#Kamera]] do M16). Model se ořízne po posunu a následném otočení (cíl už není ve středu modelu), po zoomu ke kurzoru (ten také posouvá cíl), po změně geometrie bez `fitAll` a u skic a mřížky, které do obálky nepatří.
- **View cube:** orientační i ovládací prvek, který moderní CAD má. Přináší požadavky, které `OrbitControls` nesplní (roll, animace, tažení) → [[0019-vlastni-ovladani-kamery|ADR 0019]].

## Rozhodnutí z návrhu (2026-10-14, s Pavlem)

- Rozsah jako Onshape: 26 klikacích oblastí (6 stěn, 12 hran, 8 rohů), hover, popisky stěn, 4 šipky o 90° kolem os obrazovky, 2 šipky roll ±90°, animované přechody. Navíc **tažení za cube otáčí kamerou**.
- Vzhled: stínovaná zkosená kostka, v klidu průhledná, pod myší neprůhledná.
- Volná rotace (trackball) s vlastním ovládáním místo `OrbitControls` ([[0019-vlastni-ovladani-kamery|ADR 0019]]).
- Klik na cube a šipky **jen natočí** kolem cíle, zoom a cíl zůstanou. „Zobrazit vše“ je dál zvlášť.
- Cube vpravo nahoře, osy X/Y/Z vychází z jejího rohu. Osový kříž vlevo dole zmizí.
- Vykreslení: druhá malá scéna ve stejném canvasu (scissor, jako dosavadní osový kříž) a průhledný DOM prvek nad rohem pro události. Šipky jsou DOM/SVG.

## Úkoly

- [x] 1. `near`/`far` před každým snímkem z obálky všeho viditelného (oprava ořezávání, ještě s `OrbitControls`)
- [x] 2. Fasáda `quat` v `core` a čisté operace kamery
- [x] 3. Stavový model kamery, nový `CameraRig` a `CameraInput` bez `OrbitControls`, animace
- [x] 4. Čisté části view cube: geometrie, `cubeRegionAt`, rozvržení, klik vs. tažení
- [x] 5. Vrstva view cube ve viewportu, odstranění osového kříže, paleta
- [x] 6. Popisky view cube z `ui` přes `app`
- [x] 7. Ověření v prohlížeči (světlé i tmavé téma), `architecture-reviewer`, uzavření milníku

## Implementační plán

Jeden úkol = jedno spuštění subagenta `implementer` (TDD, `npm run check`). Pořadí je záměrné: úkol 1 opraví ořezávání samostatně a hned. Uživatel tak má opravu, i kdyby se zbytek zdržel.

### Společná pravidla (platí pro každý úkol)

- Kontrakt je [[09-vykreslovani#Kamera]] a [[09-vykreslovani#View cube]], u `quat` [[02-core#Matematika (hodnotové typy)]]. Čísla (300 ms, 150 ms, 3 px, 0,55, 132/96/8 px, `bevel` 0,25, `pad` 5 % / 1 mm, clamp 0,01–1e6, faktor kolečka 0,002) se berou ze spec doslova.
- Čisté soubory `render` bez importu `three` se přidávají do pravidla `render-pure-files-without-three` v `.dependency-cruiser.cjs` (seznam v `from.path`).
- Vektory jen přes fasádu `vec3`/`quat` z `@/core` ([[0012-gl-matrix-za-fasadou|ADR 0012]]), `gl-matrix` se importuje jen v `src/core/math/`.
- Veřejné API `CameraController` (`fitAll`, `setView`, `setViewDirection`) se nemění. `interaction` a `app` o rigu, animaci ani view cube nevědí, kromě popisků (úkol 6).
- Žádné `any`, neměnná data, komentáře a identifikátory anglicky.

### Na co si dát pozor (krajní případy bez vlastního úkolu)

Spec je o nich zticha, ale uživatele by kously. Testy k nim jsou rozepsané u úkolů, které vlastní příslušný kód.

1. **HiDPI (`devicePixelRatio` 2):** scissor kostky a picking v ní musí sedět i na Retina. `viewCubeRect` vrací CSS px, násobení `pixelRatio` dělá renderer (zjištěno v úkolu 4, `setViewport`/`setScissor` násobí samy).
2. **Rychlé kliky během animace:** dva kliky na šipku za sebou = 180°. Klik na cube během animace míří z cílové orientace na novou. Testy modelu, úkol 3.
3. **Plátno nulové velikosti** (skrytý panel) během tažení nebo animace: žádné `NaN` ve stavu, operace s výškou 0 nic nedělají. Úkoly 2 a 3.
4. **Remount a dispose:** opakovaný `mount`/`unmount` nezdvojí překryv view cube ani posluchače. Běžící animace po `unmount` neplánuje snímky. Úkoly 3 a 5.
5. **Extrémní měřítka** (model 1e5 mm nebo 0,01 mm): `clipRange` drží `pad ≥ 1`, zoom clamp nedovolí 0 ani ∞. Úkoly 1 a 2.

### 1. Near a far za běhu

- **Soubory:** `src/render/camera-ops.ts` (nový, čistý, + test: `clipRange`), `src/render/camera-math.ts` (+ test: `fitOrtho` bez hloubky), `.dependency-cruiser.cjs` (`camera-ops` mezi čisté soubory), `src/render/sketch-layer.ts` (`bounds()`), `src/render/overlay-layer.ts` (`bounds()`), `src/render/camera-controller.ts` (`updateClip`), `src/render/viewport.ts` (`sceneBounds()`, volání v `draw`, `pick`, `screenToRay`), `src/render/scene-helpers.ts` (export obálky mřížky jako konstanty `GRID_BOUNDS`).
- **Kontrakt:**
  - `clipRange(bounds: BoundingBox, target: Vec3, direction: Vec3): { distance: number; near: number; far: number }` podle tabulky *Operace* ve spec. Čistá funkce v `camera-ops.ts` (úkol 2 do souboru přidá ostatní operace).
  - `OrthoFit` ztrácí `distance`, `near`, `far` a `fitOrtho` je přestane počítat (signatura zatím zůstává se `direction`, bázi dostane až úkol 3).
  - `SketchLayerInternal.bounds(): BoundingBox | null` a `OverlayLayerInternal.bounds(): BoundingBox | null` jsou obálky pozic všech kreseb nebo tvarů, `null` když nic není.
  - `CameraRig.updateClip(bounds: BoundingBox): void` dá kameru na `target + direction · distance` (směr z aktuální polohy, cíl z `controls.target`), nastaví `near`/`far`, zavolá `updateProjectionMatrix` a nevolá `requestRender`. U `OrbitControls` posun podél osy nemění orientaci.
  - Ve viewportu `sceneBounds()` = `unionBounds` z `layer.bounds()`, `sketchLayer.bounds()`, `overlayLayer.bounds()`, `GRID_BOUNDS` a bodu cíle. Volá se na začátku `draw()` a na začátku `pick` i `screenToRay`.
- **Testy (Node):** `clipRange` u obálky před cílem, za cílem, kolem cíle a s cílem daleko mimo obálku: všechny rohy mají hloubku v ⟨near, far⟩ s rezervou ≥ `pad/2`. U bodové obálky je `pad = 1`. U obálky 1e5 mm je `pad = 0,05 · rozsah`. Regresní test „po posunu“: cíl posunutý o 3R stranou a směr otočený o 90° stále obalí všechny rohy. `fitOrtho` regresní testy beze změny až na odebrané pole. `bounds()` vrstev se testuje jen tam, kde vrstva už testy v Node má. Jinak ruční ověření v úkolu 7.
- **Hotovo když:** testy projdou, `npm run check` je zelený, `pick-math` testy beze změny projdou.

### 2. Fasáda `quat` a operace kamery

- **Soubory:** `src/core/math/quat.ts` (+ `quat.test.ts`), `src/core/index.ts` (export `quat`, typ `Quat`), `src/core/index.test.ts` (pokud vyjmenovává exporty), `src/render/camera-ops.ts` (+ `camera-ops.test.ts`, soubor existuje z úkolu 1), `src/render/camera-math.ts` (`orientationFor`).
- **Kontrakt:**
  - `quat` podle [[02-core#Matematika (hodnotové typy)]]: `identity`, `fromAxisAngle`, `fromBasis`, `multiply`, `rotate`, `slerp`, `angle`, `normalize`. Výsledek je vždy nové pole float64 (vzor `calc` z `vec3.ts`), nulová osa vyhodí výjimku.
  - `camera-math.ts`: `orientationFor(direction: Vec3): Quat` = `quat.fromBasis(viewBasis(d).right, viewBasis(d).up, viewBasis(d).direction)`.
  - `camera-ops.ts` (vedle `clipRange` z úkolu 1):
    ```ts
    export interface CameraState { readonly target: Vec3; readonly orientation: Quat; readonly halfHeight: number }
    export type TurnAxis = 'up' | 'right' | 'view';
    export function basisOf(orientation: Quat): ViewBasis;            // right/up/direction = rotate(q, x/y/z)
    export function orbit(s: CameraState, dx: number, dy: number, height: number): CameraState;
    export function pan(s: CameraState, dx: number, dy: number, height: number): CameraState;
    export function zoomAt(s: CameraState, x: number, y: number, factor: number, width: number, height: number): CameraState;
    export function turn(orientation: Quat, axis: TurnAxis, quarterTurns: 1 | -1): Quat;
    export function ease(t: number): number;                          // easeInOutCubic, t mimo ⟨0,1⟩ se ořízne
    export function interpolate(from: Quat, to: Quat, t: number): Quat;
    ```
    Vzorce jsou v tabulce *Operace* ve spec. `height ≤ 0` nebo `width ≤ 0` vrací stav beze změny (stejný objekt).
- **Testy (Node):**
  - `quat`: identity nic neotočí. `fromAxisAngle(Z, π/2)` otočí X na Y. `multiply` aplikuje nejdřív pravý operand. `fromBasis` standardních bází otočí osy x, y, z na zadané vektory. `slerp(t = 0/1)` vrátí krajní hodnoty, u protilehlých znamének (q a −q) jde nejkratší cestou. `angle` rotací o 90° je π/2.
  - `orientationFor` pro všech 7 standardních pohledů dá `basisOf` shodnou s `viewBasis`/`STANDARD_VIEWS` (tolerance 1e-9), včetně `top`/`bottom` **bez** náklonu.
  - `orbit`: tah doprava posune průmět bodu `target + direction` (přední bod modelu) doprava, tedy kladná složka `right` po otočení. Tah dolů ho posune dolů. Tah přes celou výšku = 180° (`quat.angle`). Nulový tah a `height = 0` stav nemění. Cíl a `halfHeight` se nemění.
  - `pan`: bod pod kurzorem se posune s kurzorem (promítnutí světového bodu před a po).
  - `zoomAt`: bod pod kurzorem zůstane na stejných px. `factor > 1` zmenší `halfHeight`. Clamp na 0,01 a 1e6 dodrží invariant bodu pod kurzorem se skutečným poměrem.
  - `turn`: čtyři otočení kolem stejné osy dají identitu. `turn(front, 'up', 1)` dá pohled, kde přední stěna modelu míří doprava (kamera se dívá z −X, tedy `left`). `turn(front, 'right', 1)` dá `top`. `turn(front, 'view', -1)` (roll po směru hodinových ručiček) nechá směr (0, −1, 0) a nahoře je −X (to, co bylo vlevo, je teď nahoře).
  - `ease(0) = 0`, `ease(1) = 1`, `ease(0,5) = 0,5`, monotónní. `interpolate` v t = 0 a 1 vrací krajní orientace.
- **Hotovo když:** testy projdou, `npm run check` je zelený a nic mimo `core` a nové čisté soubory `render` se nemění.

### 3. Model kamery, nový rig a vstup

- **Soubory:** `src/render/camera-model.ts` (+ test, čistý), `src/render/camera-input.ts` (čisté funkce `cameraGesture`, `wheelFactor` + test; DOM posluchače v `camera-rig-input.ts`, nebo v `camera-controller.ts`, pokud zůstane pod ~250 řádků), `src/render/camera-controller.ts` (přepis bez `OrbitControls`), `src/render/camera-math.ts` (`fitOrtho(bounds, basis: ViewBasis, aspect, margin)`), `src/render/viewport.ts` (`tick` v `draw`, `now` z deps), smazat `src/render/orbit-direction.ts` (+ test). Mazání kódu v `src/` je v pořádku, zákaz platí jen pro vault. `.dependency-cruiser.cjs`: `camera-model`, `camera-input` mezi čisté soubory, `orbit-direction` ze seznamu pryč.
- **Kontrakt:**
  ```ts
  // camera-model.ts – čistý, jediný zdroj pravdy o kameře
  export interface CameraModel {
    readonly state: CameraState;
    /** Cílová orientace běžící animace, jinak aktuální. */
    readonly goal: Quat;
    readonly animating: boolean;
    set(state: CameraState): void;                 // zruší animaci (orbit/pan/zoom/fit z rigu)
    animateTo(orientation: Quat, now: number): void; // úhel < 1e-6 → nic; jinak z aktuální na cílovou, 300 ms
    tick(now: number): boolean;                     // posune animaci; true = běží dál
    cancelAnimation(): void;                        // zůstane mezilehlá orientace
  }
  export function createCameraModel(initial: CameraState): CameraModel;

  // camera-controller.ts – interní rozhraní render
  export interface CameraRig extends CameraController, Disposable {
    readonly camera: THREE.OrthographicCamera;
    readonly orientation: Quat;                      // aktuální (pro view cube)
    readonly target: Vec3;                           // aktuální cíl, součást obálky pro near/far (zavedeno v úkolu 1)
    attach(element: HTMLElement): void;              // pointer + wheel posluchače (CameraInput), jeden naráz
    detach(): void;
    resize(width: number, height: number): void;
    updateClip(bounds: BoundingBox): void;           // z úkolu 1
    orbit(dx: number, dy: number): void;             // výška z posledního resize; zruší animaci
    animateTo(orientation: Quat): void;              // now() z options
    turn(axis: TurnAxis, quarterTurns: 1 | -1): void; // animateTo(turn(model.goal, …))
    tick(now: number): boolean;                      // model.tick + promítnutí stavu do THREE kamery
  }
  export interface CameraRigOptions { getBounds; requestRender; readonly now: () => number }
  ```
  - Rig po každé změně stavu promítne stav do `camera.quaternion`, `left/right/top/bottom` (`zoom = 1`) a zavolá `requestRender`. `position` doplní `updateClip`.
  - `camera.up` se dál nastavuje na (0, 0, 1) jen kvůli konzistenci, nic na něm nezávisí.
  - `CameraInput`: mapování tlačítek přes `cameraGesture(button: 0|1|2, shift, mod): 'orbit'|'pan'|null` (2 → orbit, 1 → pan, s Shift/mod prohozeně, 0 → null). `wheelFactor(deltaY, deltaMode, height)`. Pointer capture, `pointercancel`/`lostpointercapture` ukončí gesto. `wheel` s `{ passive: false }` a `preventDefault`. `mod` = `metaKey` na Macu, jinak `ctrlKey` (jako `toViewPointerEvent`).
  - Viewport: `draw()` nejdřív `rig.tick(now())`, při `true` po vykreslení `scheduleFrame()`. Výchozí pohled při prvním mountu `setView('iso')` beze změny.
  - `three/addons/controls/OrbitControls.js` se už nikde neimportuje.
- **Testy (Node):** `createCameraModel` s ručním `now`:
  - `animateTo` v polovině času dá orientaci `interpolate(from, to, 0,5)` a po 300 ms přesně cíl. `tick` pak vrací `false`.
  - Dvakrát `animateTo(turn(goal, 'up', 1))` rychle za sebou skončí na 180° od počátku.
  - `set` během animace ji zruší a `animating` je `false`. `cancelAnimation` nechá mezilehlou orientaci.
  - Úhel < 1e-6 nespustí animaci.
  - `cameraGesture` je tabulka všech kombinací. `wheelFactor` pro `deltaMode` 0/1/2, záporné `deltaY` dá faktor > 1.
  - Rig s Three.js se netestuje ([[Q061 Testy render v Node|Q061]]), ověřuje ho úkol 7.
- **Hotovo když:** testy projdou, `npm run check` je zelený, v `src/` není žádný import `OrbitControls` ani `orbit-direction`.

### 4. Čisté části view cube

- **Soubory:** `src/render/view-cube-geometry.ts` (+ test), `src/render/view-cube-layout.ts` (+ test), `.dependency-cruiser.cjs`.
- **Kontrakt:**
  ```ts
  export type CubeRegion = Vec3;                    // (sx, sy, sz) ∈ {−1,0,1}³ ∖ {0}
  export interface ViewCubeMesh {
    readonly positions: Float32Array; readonly normals: Float32Array; readonly uvs: Float32Array;
    readonly index: Uint32Array;
    /** Jedna skupina na oblast: rozsah indexů a směr oblasti. */
    readonly groups: readonly { readonly start: number; readonly count: number; readonly region: CubeRegion }[];
  }
  export function buildViewCube(bevel?: number): ViewCubeMesh;      // výchozí 0,25
  export function cubeRegionAt(point: Vec3, bevel?: number): CubeRegion | null; // null u (0,0,0)
  export function regionKey(region: CubeRegion): string;            // "1,-1,0"
  /** Báze popisku stěny: osa textu vpravo a nahoru = viewBasis(směr stěny). */
  export function faceLabelBasis(face: CubeRegion): { readonly right: Vec3; readonly up: Vec3 };

  // view-cube-layout.ts
  export const VIEW_CUBE = { box: 132, cube: 96, margin: 8, dragThreshold: 3 } as const;
  /** Čtverec kostky v CSS px pro renderer.setViewport/setScissor (y zdola); pixelRatio násobí renderer. */
  export function viewCubeRect(canvasWidthCss: number, canvasHeightCss: number): { x: number; y: number; size: number };
  /** Bod v CSS px relativně k překryvu → NDC kamery kostky, null mimo čtverec kostky. */
  export function cubeNdc(x: number, y: number): { x: number; y: number } | null;
  /** Rozlišení kliku a tažení: true, jakmile vzdálenost od startu překročí práh (a pak už navždy). */
  export function isDrag(startX: number, startY: number, x: number, y: number): boolean;
  ```
- **Testy (Node):**
  - `buildViewCube` má 26 skupin s různými `regionKey`: 6 s jednou nenulovou složkou, 12 se dvěma, 8 se třemi. Všechny normály jsou jednotkové a míří ven (skalární součin s těžištěm trojúhelníku > 0). Indexy jsou v rozsahu. Každý trojúhelník skupiny má vrcholy, pro které `cubeRegionAt(těžiště) = region` skupiny.
  - `cubeRegionAt`: středy stěn, bod na zkosení hrany a v rohu. Hranice 1 − `bevel` patří ještě hraně (tolerance 1e-6).
  - `faceLabelBasis` sedí s `viewBasis` pro všech 6 stěn (top: nahoru +Y).
  - `viewCubeRect(800, 600)` = `{ x: 800 − 122, y: 600 − 122, size: 96 }` (CSS px). Odsazení kostky v překryvu (132 − 96)/2 = 18 px, y v bufferu se počítá zdola.
  - `cubeNdc` ve středu = (0, 0), na rohu čtverce ±1, mimo čtverec `null`.
  - `isDrag` na 3 px `false`, na 3,01 px `true`.
- **Hotovo když:** testy projdou a `npm run check` je zelený.

### 5. Vrstva view cube ve viewportu

- **Soubory:** `src/render/view-cube.ts` (nový: malá scéna, materiály, textury popisků, osy, překryv DOM, šipky, události), `src/render/viewport.ts` (vytvoření, `draw`, `mount`/`unmount`, `setPalette`, `setViewCubeLabels`, volba `viewCubeLabels`), `src/render/scene-helpers.ts` (pryč osový kříž, `drawAxes`, `AXES_*`), `src/render/palette.ts` (+ test: `viewCube`), `src/render/index.ts` (export typů `ViewCubeLabels`, `ViewCubeLabelKey`, konstanty `DEFAULT_VIEW_CUBE_LABELS`).
- **Kontrakt:** [[09-vykreslovani#View cube]] celá, plus:
  ```ts
  export interface ViewCube extends Disposable {
    mount(el: HTMLElement, canvas: HTMLCanvasElement): void;  // vloží překryv do el; dvakrát bez unmount = chyba
    unmount(): void;                                          // odebere překryv a posluchače, idempotentní
    draw(renderer: THREE.WebGLRenderer, orientation: Quat): void;  // po hlavní scéně
    tick(now: number): boolean;                               // přechod průhlednosti; true = běží
    setPalette(palette: ScenePalette): void;
    setLabels(labels: ViewCubeLabels): void;                  // stejné hodnoty = nic
  }
  export function createViewCube(options: {
    readonly rig: Pick<CameraRig, 'orbit' | 'animateTo' | 'turn'>;
    readonly palette: ScenePalette; readonly labels: ViewCubeLabels;
    readonly requestRender: () => void; readonly now: () => number;
  }): ViewCube;
  ```
  - `draw` viewportu: `rig.tick`, `viewCube.tick`, `sceneBounds`/`updateClip`, hlavní scéna, `viewCube.draw`. Když některý `tick` vrátil `true`, následuje `scheduleFrame()`.
  - Tažení za cube volá `rig.orbit(dx, dy)` (výška hlavního plátna je v rigu z `resize`).
  - Hover oblasti mění barvu jen její skupiny (pole materiálů indexované skupinami, nebo klonovaný materiál pro hover). Popisky jsou `CanvasTexture` 256 × 256 px, při `setLabels` se překreslí a nastaví `needsUpdate`.
  - Paleta: `viewCube: [face, text]`, světlá `[0xffffff, 0x374151]`, tmavá `[0x4b4f57, 0xe5e7eb]`. `freezePalette` zmrazí i nové pole.
  - `dispose` viewportu uvolní geometrii, materiály a textury kostky i os.
- **Testy:** `palette.test.ts` (nové pole v obou paletách, zmrazené). Ostatní kód s Three.js a DOM ručně v úkolu 7 ([[Q061 Testy render v Node|Q061]]). Pokud má viewport testy s jsdom (`tsconfig.test-app.json`), přidej test, že `mount`/`unmount`/`mount` nechá v `el` právě jeden překryv `.tc-view-cube` a `dispose` žádný.
- **Hotovo když:** `npm run check` je zelený, `scene-helpers` nemá osový kříž a dev server ukáže kostku vpravo nahoře (rychlá kontrola v prohlížeči, plná až v úkolu 7).

### 6. Popisky z `ui` přes `app`

- **Soubory:** `src/app/session.ts` (`AppViewport.setViewCubeLabels`, `AppSession.setViewCubeLabels`), `src/app/index.ts` (re-export typu `ViewCubeLabels`), `src/app/testing.ts` (`FakeAppViewport` zaznamená popisky), `src/app/browser.ts` (počáteční popisky nemusí, `ui` je nastaví hned), `src/ui/i18n/cs.ts`, `src/ui/i18n/en.ts` (12 klíčů `viewCube.*`), `src/ui/i18n/i18n.test.ts` (klíče skládané za běhu, pokud je test hlídá), `src/ui/components/AppShell.vue` (`watch` jazyka s `immediate: true` → `session.setViewCubeLabels`), případně čistá pomocná funkce `viewCubeLabels(t)` v `src/ui/` (+ test).
- **Kontrakt:** [[11-ui#Kompoziční kořen (app)]] (`setViewCubeLabels`) a texty cs/en v [[11-ui]] (odstavec o popiscích view cube).
- **Testy:** `app`: `setViewCubeLabels` předá popisky `FakeAppViewport` beze změny. `ui`: `viewCubeLabels(t)` vrátí všech 12 klíčů a pro cs/en přesné texty ze spec. Testy i18n (úplnost klíčů v obou jazycích) projdou.
- **Hotovo když:** `npm run check` je zelený a přepnutí jazyka v aplikaci změní popisky na kostce.

### 7. Ověření a uzavření (hlavní sezení, ne `implementer`)

- Dev server, ruční scénáře z akceptačních kritérií ve světlém i tmavém tématu, na Retina i při `devicePixelRatio` 1. Screenshoty pro Pavla.
- Doladění rozměrů a barev (osy, opacity), pokud vizuálně nesedí. Změny propsat do spec 09.
- `architecture-reviewer`, pak `/milnik konec M17`, spec 09 zpět na `implemented`, retrospektiva.

## Akceptační kritéria

- Model se neořízne po: posunu a otočení, zoomu ke kurzoru, přidání většího tělesa bez `fitAll`, skice mimo obálku těles. Ověřeno testy `clipRange` a ručně v prohlížeči.
- Pravé tlačítko otáčí volně (i „vzhůru nohama“), prostřední posouvá, kolečko zoomuje ke kurzoru a bod pod kurzorem zůstává na místě.
- Klik na kteroukoli z 26 oblastí cube plynule (≈ 300 ms) natočí kameru do odpovídajícího směru se Z nahoru (u top/bottom Y nahoru), cíl a zoom zůstanou.
- Šipky otočí o 90° kolem os obrazovky a kolem osy pohledu, animovaně.
- Tažení za cube otáčí kamerou stejně jako pravé tlačítko ve scéně; posun do 3 px je klik.
- Cube je stínovaná, v klidu průhledná, pod myší neprůhledná se zvýrazněnou oblastí; popisky odpovídají jazyku UI; vzhled sedí ve světlém i tmavém tématu.
- `setView`, `setViewDirection` a `fitAll` se chovají jako dřív (z pohledu `interaction` a `app` se API nemění).
- `npm run check` zelený, `architecture-reviewer` bez nálezů.

## Co se naučíš

- Reprezentace orientace quaternionem a proč nemá degeneraci podél osy Z (gimbal lock sférických souřadnic).
- Slerp a easing pro plynulé animace kamery v systému „render on demand“.
- Proč u ortografické kamery smí `near`/`far` „dýchat“ se scénou bez vlivu na obraz.
- Oddělení „kde se kreslí“ (sdílený WebGL renderer) od „kdo dostává události“ (DOM vrstva).

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Retrospektiva

**Co šlo dobře**
- Pořadí úkolů „oprava ořezávání napřed“ se vyplatilo. Úkol 1 opravil chybu ještě nad `OrbitControls`, protože u ortho kamery stačí posouvat kameru po její ose. Oprava tak nezávisela na přepisu ovládání.
- Oddělení čistého `createCameraModel` od rigu s Three.js umožnilo testovat animace v Node s ručním časem, včetně „dva rychlé kliky = 180°“. V Three.js zůstalo jen promítnutí stavu do kamery.
- Konkrétní příklady znamének v plánu (`turn(front, 'right', 1)` → `top`) prošly napoprvé. Implementátor je ověřil testem a rozpor nenašel.

**Co bylo jinak, než se čekalo**
- Plán úkolu 4 chtěl `viewCubeRect` v pixelech bufferu. Three.js ale násobí `pixelRatio` samo, takže na Retina by se násobilo dvakrát. Implementátor to našel ve zdrojáku Three.js ještě před úkolem 5 → [[Logické a fyzické pixely v Three.js]].
- Doplnila se drobná rozhodnutí, která spec neřešila:
  - `animateTo` na aktuální orientaci zastaví běžící animaci,
  - `zoomAt` odmítne faktor, který není konečné kladné číslo,
  - prostřední tlačítko volá `preventDefault` (autoscroll ve Windows),
  - `touch-action: none` na canvasu,
  - šipky se ukážou i při fokusu klávesnicí,
  - stěny s popiskem nesou barvu v textuře, protože `map` se násobí barvou materiálu.
  Všechno je propsané do spec 09.
- `architecture-reviewer` našel zastaralou větu o `camera.up` ve spec 01 a `isMac` zjišťované na dvou místech. Obojí je opravené.

**Ověření v prohlížeči (2026-10-14):**
- Funguje otáčení pravým tlačítkem, posun prostředním a zoom kolečkem ke kurzoru.
- Po zoomu, posunu a otočení se model neořízl.
- „Zobrazit vše“ drží orientaci.
- Klik na stěnu Front, šipka doprava (→ Left), roll i tažení za kostku fungují.
- Světlé i tmavé téma a přepnutí jazyka jsou v pořádku.
- Při `devicePixelRatio` 2 sedí kreslení kostky i klikání do ní.
- Ručně zbývá vyzkoušet skutečnou myš s pravým a prostředním tlačítkem a autoscroll ve Windows. Syntetické události v prohlížeči to nepokryjí.
