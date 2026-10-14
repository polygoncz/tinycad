---
type: spec
status: implemented
order: 9
aliases:
  - render – vykreslování
  - Spec 09
modules:
  - render
milestones:
  - "[[M08-vykreslovani]]"
  - "[[M12-skicar]]"
  - "[[M13-extrude-revolve]]"
  - "[[M14-topologicke-pojmenovani]]"
  - "[[M15-export-a-dokonceni]]"
  - "[[M17-kamera-a-view-cube]]"
  - "[[M17.1-rezim-otaceni]]"
tags:
  - spec
created: 2026-10-12
updated: 2026-10-14
---
# 09 – `render`: vykreslování

> **Pojmy:** [[Viewport]], [[Handle tvaru]], [[Těleso]]  
> **Milník:** [[M08-vykreslovani]], kamera a view cube [[M17-kamera-a-view-cube]]  
> **Rozhodnutí:** [[0019-vlastni-ovladani-kamery|ADR 0019]], [[0020-rezim-otaceni-kamery|ADR 0020]]

Zobrazuje výsledek regenerace pomocí Three.js a odpovídá na otázku „co je pod kurzorem“. O dokumentu ani featurách neví nic – pracuje s tělesy (`BodyId`), handle a sítěmi. Závisí na `core`, typech z `kernel`, typech z `interaction` (port `ViewportPort`, události a `BodyId`, [[0009-platformove-nezavisla-domena|ADR 0009]]) a knihovně `three`.

## Závislost

`three` ~0.186 a `@types/three` ~0.186 (dev). Z `kernel` bere `render` jen typy `MeshData`, `MeshOps`, `MeshQuality`, `ShapeHandle` a `BoundingBox`. Three.js má verze `0.x`, minor vydání může rozbít API, proto `~`. Z `three/addons` (podcesta stejného balíku) jen `LineSegments2`/`LineMaterial`. `OrbitControls` se do [[M17-kamera-a-view-cube|M17]] používaly pro kameru, od M17 je nahradilo vlastní ovládání ([[0019-vlastni-ovladani-kamery|ADR 0019]]). Nové ADR není potřeba, Three.js zvolil [[0001-jadro-v-cistem-ts|ADR 0001]] ([[Q062 Závislost three a OrbitControls|Q062]]).

## Viewport

```ts
export interface Viewport extends ViewportPort, Disposable {
  mount(el: HTMLElement): void;        // vytvoří canvas, renderer, ResizeObserver, ovládání kamery; podruhé bez unmount = chyba
  unmount(): void;                     // uvolní renderer a canvas, scéna (tělesa, kamera) zůstává; idempotentní

  requestRender(): void;               // vykreslení na požádání, ne smyčka 60 fps
  pick(x: number, y: number, filter?: PickFilter): PickResult | null;   // px vůči canvasu (CSS px); nepřipojený viewport → null; filtr viz spec 10
  screenToRay(x: number, y: number): { origin: Vec3; direction: Vec3 };  // nepřipojený → chyba

  readonly bodies: BodyLayer;          // tělesa z regenerace
  readonly highlight: HighlightLayer;  // hover a výběr (implementuje HighlightPort)
  readonly overlay: OverlayLayer;      // dočasná geometrie nástrojů (implementuje OverlayPort)
  readonly sketches: SketchLayer;      // kresby skic a rovin (implementuje SketchPort, M12)
  readonly camera: CameraController;   // fit all, standardní pohledy, kolmo na rovinu (M12)

  setPalette(palette: ScenePalette): void;   // přebarví existující materiály, nic nevytváří znovu (Q072)
  setBodyVisible(body: BodyId, visible: boolean): void; // stav pohledu z Prohlížeče (Q071)
  setBodyColor(body: BodyId, color: string | null): void; // M15: '#rrggbb' z metadat tělesa, null = barva palety
  setViewCubeLabels(labels: ViewCubeLabels): void;       // M17: popisky stěn a šipek view cube (viz View cube)
  setOrbitMode(mode: OrbitMode): void;                    // M17.1: režim otáčení (viz Kamera → Režim otáčení); stejná hodnota = nic
  onOrbitModeToggle(listener: () => void): Unsubscribe;   // M17.1: klik na tlačítko režimu u view cube; dispose odběratele uvolní

  readonly events: Subscribable<{ pointer: ViewPointerEvent; key: ViewKeyEvent }>;
}

export function createViewport(deps: {
  meshes: MeshOps;
  quality?: MeshQuality;                              // výchozí MESH_QUALITY
  palette?: ScenePalette;                             // výchozí LIGHT_PALETTE (nahrazuje background)
  reportError?: (body: BodyId, error: unknown) => void;  // výchozí console.error
  viewCubeLabels?: ViewCubeLabels;                    // M17, výchozí anglické
  now?: () => number;                                 // M17, hodiny animací, výchozí performance.now
}): Viewport;

export const MESH_QUALITY: MeshQuality = { linearDeflection: 0.1, angularDeflection: 0.5 };

/** Barvy scény jako 0xRRGGBB. Hodnota, žádné CSS – render nezná DOM (Q072). */
export interface ScenePalette {
  readonly background: number;
  readonly face: number;
  readonly edge: number;
  readonly hover: number;
  readonly selection: number;   // odpovídá --accent v CSS
  readonly preview: number;     // overlay nástrojů
  readonly construction: number;
  readonly sketch: number;          // nedourčená skica (M12): světlá 0x0a84ff, tmavá 0x409cff
  readonly sketchDefined: number;   // plně určená skica (M12): světlá 0x1c1c1e, tmavá 0xf2f2f7
  readonly axes: readonly [x: number, y: number, z: number];   // obě palety 0xff3b30, 0x34c759, 0x0a84ff (mockup)
  readonly grid: readonly [center: number, line: number];
  readonly viewCube: readonly [face: number, text: number];   // M17: světlá 0xffffff, 0x374151; tmavá 0x4b4f57, 0xe5e7eb
}
export const LIGHT_PALETTE: ScenePalette;
export const DARK_PALETTE: ScenePalette;
```

- Typy portu (`ViewportPort`, `PickResult`, `HighlightTarget`, `HighlightPort`, `OverlayPort`, události, `BodyId`) definuje [[10-interakce#Port viewportu]], `render` je importuje jen jako typy z `@/interaction`.
- `mount`, `bodies` a `camera` nejsou součástí portu: používá je jen `app` (kompoziční kořen). Nástroje vidí jen `ViewportPort`.
- `dispose()`: `unmount()`, uvolní všechna tělesa, zvýraznění, overlay, ovládání kamery a odběratele `events`. Další volání čehokoli kromě `dispose` je chyba, i na podobjektech (`bodies`, `camera`, `highlight`, `overlay`, `events.on`).
- Barvy scény jsou jen v `ScenePalette` ([[Q072 Barvy scény podle režimu|Q072]]): konstanty `FACE_COLOR`, `EDGE_COLOR`, barvy ve `highlight-layer`, `overlay-layer` a `scene-helpers` se nahradí čtením z palety. `setPalette` změní barvy materiálů a pozadí a zavolá `requestRender()`. Paletu vybírá `app` podle režimu, který mu předá `ui` (`AppSession.setTheme`); `ui` typy z `render` nezná.
- `setBodyVisible` jen skryje nebo ukáže `BodyView` (`visible`); picking skryté těleso ignoruje (ani nezakrývá tělesa za ním), zvýraznění skrytého tělesa se nekreslí a `camera.fitAll` ho vynechá (rozhodnutí 2026-10-13). Obojí jde přes `BodyLayer.bounds()`, který počítá jen viditelná tělesa; z něj bere i picker toleranci zakrytí. Světla scény paleta nemá. Těleso, které po `sync` zmizí, ztratí i stav viditelnosti. Viditelnost se neukládá ([[Q071 Viditelnost těles|Q071]]).
- `setBodyColor` (M15, [[Q073 Průhlednost a barva těles|Q073]]): těleso s barvou dostane materiál ploch s touto barvou (kopie sdíleného materiálu ploch; materiály podle barvy sdílí tělesa se stejnou barvou, `BodyLayer` je drží s počtem uživatelů a uvolní, když je nikdo nepoužívá), `null` vrátí sdílený materiál palety. Hrany zůstávají v barvě palety. Barva je stav vrstvy podle `BodyId` jako viditelnost: přežije `sync` s novým handle a zmizí s tělesem. `setPalette` mění jen výchozí materiál, obarvená tělesa ne. Stejná hodnota nic nepřekresluje, jinak `requestRender()`. Převod `#rrggbb` → číslo je čistá funkce `parseHexColor` v `palette.ts` (neplatný text → výjimka; platnost hlídá už dokument, [[03-dokument#Metadata těles]]). Barva tělesa, které ve vrstvě ještě **není** zobrazené (před dokončením `sync`), se zahodí (neplatný text ale vyhodí vždy – kontrola je před hledáním tělesa). Uloženou barvu dodá `app` z `BrowserModel.colors` ([[10-interakce#Prohlížeč: `BrowserModel` a viditelnost těles]]) a po každém dokončeném `sync` ji použije znovu, stejně jako skrytí ([[11-ui#Kompoziční kořen (app)]]).
- `mount` je odolný proti chybě (např. prohlížeč bez WebGL): uvolní, co už vytvořil, a výjimku pošle dál.
- Známé omezení: Three.js si na materiálech registruje posluchače `dispose` s odkazem na renderer, takže materiály žijící celý život viewportu mohou po opakovaném `mount`/`unmount` držet staré renderery v paměti CPU až do `dispose`. Opakovaný mount je vzácný, neřešíme.
- `unmount()` volá `renderer.forceContextLoss()`: prohlížeč dovolí jen několik kontextů WebGL a opakovaný `mount` by je vyčerpal. Po opětovném `mount` zůstane kamera, jak byla, výchozí pohled (`iso` + `fitAll`) se nastaví jen při prvním `mount`.

### Vykreslování na požádání

Jediný plánovač snímků (`FrameScheduler`, čistý modul s injektovaným `requestAnimationFrame`/`cancelAnimationFrame`): `request()` nastaví příznak a naplánuje **nejvýš jeden** snímek, další volání do vykreslení nic nedělají. `dispose()` zruší naplánovaný snímek. `requestRender()` volají vrstvy (`bodies`, `highlight`, `overlay`) po každé změně, kamera po každé operaci (`CameraInput`, view cube) a `ResizeObserver`. Běžící animace kamery nebo průhlednosti view cube (`tick` vrátí `true`) si po snímku vyžádá další (M17). Mimo tyto podněty se nevykresluje vůbec, statická scéna nežere CPU ani baterii.

### Kamera

> Od [[M17-kamera-a-view-cube|M17]] vlastní ovládání místo `OrbitControls` ([[0019-vlastni-ovladani-kamery|ADR 0019]]). Do M16 platil invariant `camera.up = (0, 0, 1)` a náklon `top`/`bottom` o 1e-4 rad; obojí zmizelo.

- **Ortografická** (`THREE.OrthographicCamera`, [[Q016 Ortografická nebo perspektivní kamera|Q016]]), `camera.zoom` je vždy 1.
- **Stav rigu** (jediný zdroj pravdy): `target: Vec3`, `orientation: Quat` (rotace, která převede osy kamery x, y, z na `right`, `up`, `direction`; `direction` = jednotkový vektor od cíle ke kameře) a `halfHeight` (polovina viditelné výšky v mm, viditelná šířka = 2 · `halfHeight` · `aspect`). Three.js kamera se ze stavu jen odvozuje (`quaternion`, `position`, `left/right/top/bottom`, `near/far`).
- Při změně velikosti plátna se přepočítá `left/right/top/bottom` podle poměru stran, `halfHeight` zůstane.

```ts
export type StandardView = 'iso' | 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right';

export interface CameraController {        // veřejné API, beze změny proti M12
  fitAll(): void;                          // obálka viditelných těles v aktuální orientaci; prázdná scéna → výchozí výřez 200 × 200 mm kolem počátku
  setView(view: StandardView): void;       // orientace standardního pohledu (okamžitě), pak fitAll()
  setViewDirection(direction: Vec3): void; // M12: orientationFor(direction) (okamžitě), pak fitAll(); nulový vektor = chyba
}
```

- `fitAll`, `setView` a `setViewDirection` zruší běžící animaci. `fitAll` drží aktuální orientaci včetně natočení kolem osy pohledu.
- **Orientace ze směru** `orientationFor(direction)`: báze `viewBasis(direction)` (nahoře je +Z promítnuté do roviny pohledu, při pohledu podél Z je to +Y) převedená na quaternion. Standardní pohledy (odkud se kamera dívá, co je nahoře): `front` z −Y (+Z), `back` z +Y, `right` z +X, `left` z −X, `top` z +Z (+Y), `bottom` z −Z (+Y), `iso` z (1, −1, 1) (+Z promítnuté). Pohled přesně podél Z už není degenerovaný, `orbit-direction.ts` (`VIEW_TILT`, `orbitDirection`, `viewDirectionFor`) zaniká.
- **`fitOrtho(bounds, basis, aspect, margin = 0.1)`** (čistá): cíl = střed obálky, `halfHeight` tak, aby se obálka promítnutá do `basis.right`/`basis.up` vešla s okrajem 10 % na omezující straně, nejméně 1 mm. Prázdná scéna → cíl (0, 0, 0), výřez 200 × 200 bez okraje. Hloubku (`near`/`far`) už nepočítá.

#### Operace (čisté funkce, `camera-ops.ts`, bez `three`)

Vstupní posuny jsou v CSS px plátna, `width`/`height` je velikost plátna, osa y obrazovky míří dolů. `right`, `up`, `direction` jsou osy aktuální orientace ve světě.

| Operace | Kontrakt |
|---|---|
| `orbit(state, dx, dy, height, mode)` | Rotace kolem cíle, **model sleduje kurzor**: tah doprava otočí přední stranu modelu doprava, tah dolů dolů. Úhly θx = π · dx / `height`, θy = π · dy / `height` (tah přes celou výšku = 180°). **`'free'`** (trackball): θ = π · √(dx² + dy²) / `height`, osa modelu `a = normalize(up · dx + right · dy)`, kamera se otočí opačně: `orientation' = quat.multiply(quat.fromAxisAngle(a, −θ), orientation)`. **`'turntable'`** (M17.1): nejdřív model kolem světové osy **Z** o θx, pak kolem `right` (po otočení) o θy, přitom elevace `e = asin(direction · Z)` se ořízne: skutečný úhel kolem `right` je `clamp(e + θy, −π/2, π/2) − e`. Model kolem `right` o +θ zvedá kameru (elevace roste). `target` a `halfHeight` beze změny. Nulový posun = beze změny. |
| `pan(state, dx, dy, height)` | Bod pod kurzorem jde s kurzorem: `target' = target − (right · dx − up · dy) · 2 · halfHeight / height`. |
| `zoomAt(state, x, y, factor, width, height)` | `factor > 1` přibližuje, `factor` musí být konečné kladné číslo (jinak chyba programátora). `halfHeight' = clamp(halfHeight / factor, 0.01, 1e6)`. Bod pod kurzorem zůstane na místě: offset kurzoru od středu ve světě `o = (right · (x − width/2) − up · (y − height/2)) · 2 · halfHeight / height`, `target' = target + o · (1 − halfHeight'/halfHeight)` (se skutečným poměrem po clampu). |
| `turn(orientation, axis, quarterTurns, mode)` | Otočení o `quarterTurns` · 90° (±1) pro šipky view cube. `axis`: `'up'` (šipky vlevo/vpravo), `'right'` (nahoru/dolů), `'view'` (roll, jen `'free'`; v `'turntable'` chyba programátora). Stejná konvence jako `orbit`: model se točí ve směru šipky. Šipka vpravo = model kolem `up` o +90°, vlevo −90°; dolů = kolem `right` o +90°, nahoru −90°; roll po směru hodinových ručiček = model kolem `direction` o −90°, proti směru +90°. V `'turntable'` je osa `'up'` světová Z a `'right'` má ořez elevace jako `orbit` (z pohledu shora šipka dolů nic nezmění). Vrací cílovou orientaci (kamera opačně, jako u `orbit`). |
| `levelOrientation(orientation)` | M17.1: srovnání pro turntable. Mimo pól (`|direction · Z| < 1 − 1e-9`) = `orientationFor(direction)`. Na pólu se zachová azimut: `right_h = normalize(right − (right · Z) · Z)`, `direction = sign · Z`, `up = direction × right_h`. Orientace s nulovým rollem a Z nahoru (`up · Z ≥ 0`) se nezmění (do 1e-9). Orientace vzhůru nohama z volného režimu se otočí o 180° kolem osy pohledu, takže Z je zase nahoře. |
| `ease(t)` | `easeInOutCubic` na ⟨0, 1⟩. |
| `interpolate(from, to, t)` | `quat.slerp(from, to, ease(t))` (nejkratší cesta). |
| `clipRange(bounds, target, direction)` | Hloubka všeho viditelného: rohy obálky promítnuté na `direction` relativně k cíli, `sMax`, `sMin`. `pad = max(0,05 · (sMax − sMin), 1)`. Vrací `distance = sMax + pad` (kamera = `target + direction · distance`), `near = pad / 2`, `far = distance − sMin + pad`. Obálka v kameře tedy leží celá mezi `near` a `far` s rezervou, ať je cíl kdekoli. |

#### Režim otáčení (M17.1)

[[0020-rezim-otaceni-kamery|ADR 0020]]. `export type OrbitMode = 'turntable' | 'free'`, výchozí `'turntable'`.

- Invariant `'turntable'`: `basisOf(orientation).right · Z = 0` (nulový roll) po každé operaci. `orientationFor` (standardní pohledy, klik na cube, `setViewDirection`) ho splňuje.
- Rig drží režim (`setOrbitMode(mode)`, stejná hodnota = nic) a předává ho do `orbit` a `turn`. Přepnutí na `'turntable'` → `animateTo(levelOrientation(goal))`. Přepnutí na `'free'` orientaci nemění.
- Zdroj pravdy je `ui` ([[11-ui]]): `Viewport.setOrbitMode` jen nastaví režim rigu a view cube. Tlačítko u cube režim sám nemění, jen vyšle požadavek `onOrbitModeToggle`.

#### Animace

- `animateTo(orientation)` (jen interní, pro view cube): přechod z aktuální orientace slerpem, trvání 300 ms, `ease`. Úhel mezi aktuální a novou orientací pod 1e-6 rad → žádná animace a běžící animace se zastaví na místě. Uživatel klikl tam, kde právě je. Stav drží čistý `createCameraModel` (`camera-model.ts`), rig ho jen promítá do Three.js kamery. Cíl a `halfHeight` se nemění.
- Šipka nebo klik na cube během běžící animace počítá z **cílové** orientace té animace (dvojí rychlý klik na šipku = 180°).
- Orbit, posun, zoom, `fitAll`, `setView`, `setViewDirection` animaci zruší. Zůstane mezilehlá orientace.
- Čas dává injektovaná funkce `now()` (výchozí `performance.now`). Rig má `tick(now): boolean`. Viewport ho volá na začátku `draw()` a při `true` (animace běží) si vyžádá další snímek. Mimo animace se dál kreslí jen na požádání.

#### Near a far

Před každým snímkem (`draw`) a před každým `pick`/`screenToRay` rig nastaví `position`, `near`, `far` podle `clipRange` nad **obálkou všeho viditelného**: viditelná tělesa (`BodyLayer.bounds()`), kresby skic (`SketchLayer.bounds()`, nové), overlay nástrojů (`OverlayLayer.bounds()`, nové), mřížka (±100 mm v z = 0) a cíl kamery. Žádná situace (posun a otočení, zoom ke kurzoru, nové těleso bez `fitAll`, skica mimo tělesa) tak model neořízne. U ortografické kamery mění `near`/`far` jen hloubkový řez, ne velikost obrazu.

#### Vstup (`CameraInput`: čisté funkce v `camera-input.ts`, DOM posluchače v `camera-rig-input.ts`)

Poslouchá na canvasu vedle převodu událostí pro `interaction` (ten zůstává beze změny, viz Události).

- Gesta jako v Onshape: **pravé** tlačítko otáčí, **prostřední** posouvá, **kolečko** zoomuje ke kurzoru. S klávesou Shift nebo Ctrl/Cmd se otáčení a posun prohodí (jako dřív u `OrbitControls`). Levé tlačítko kameru neovládá, patří výběru. Kontextové menu na canvasu je potlačené.
- Čisté funkce: `cameraGesture(button, shiftKey, modKey) → 'orbit' | 'pan' | null` a `wheelFactor(deltaY, deltaMode, height) = exp(−0,002 · deltaY_px)`, kde `deltaY_px = deltaY` (`deltaMode` 0), · 16 (1, řádky), · `height` (2, stránky).
- `pointerdown` s gestem → `setPointerCapture`, zruší animaci. `pointermove` posílá rozdíly od minulé polohy. `pointerup`, `pointercancel` a `lostpointercapture` gesto ukončí. `wheel` s `passive: false` a `preventDefault()` (i Ctrl + kolečko, tedy pinch na trackpadu).
- Prostřední `pointerdown` volá `preventDefault()`, aby se ve Windows nespustil autoscroll. Ten vzniká z kompatibilního `mousedown`. Canvas má po dobu připojení `touch-action: none`, jako dřív u `OrbitControls`.
- Dotykové ovládání se zatím neřeší.

### Scéna

- Mřížka 200 × 200 mm v rovině XY (`GridHelper` otočený o 90° kolem X; `depthWrite = false`, `renderOrder = -1`, takže se kreslí první a tělesa ji vždy zakryjí. Bez toho by mřížka v z = 0 bojovala se spodními plochami těles o hloubku. Důsledek: mřížku tělesa zakryjí i tam, kde by měla být před nimi, třeba při pohledu zespodu).
- Světla: slabé `HemisphereLight` + `DirectionalLight` připnuté ke kameře („čelovka“), takže osvětlení sleduje pohled jako v CAD.
- Osový kříž vlevo dole (do M16) nahradily osy ve view cube.

### View cube

> [[M17-kamera-a-view-cube|M17]]. Orientační a ovládací kostka vpravo nahoře, jako v Onshape.

**Rozvržení.** Viewport v `mount` vloží do `el` (rodič s `position` jinou než `static`; `ViewportHost` má `absolute`) překryvný `div` 132 × 132 CSS px, 8 px od pravého a horního okraje. Uprostřed je čtverec 96 × 96 px, do kterého se kreslí kostka. Kolem něj jsou šipky. Překryv chytá všechny pointer události nad sebou, takže se nedostanou k canvasu ani k výběru v `interaction`.

**Kreslení.** Druhá malá scéna ve stejném rendereru (jeden WebGL kontext): po hlavní scéně `clearDepth`, `setViewport`/`setScissor` na čtverec kostky v **CSS px**, osa y zdola. Renderer je sám násobí svým `pixelRatio`, takže HiDPI tu nic dalšího nepotřebuje, stejně jako dřív u osového kříže. Ortografická kamera kostky (výřez ±1,8) má orientaci hlavní kamery a stojí na `orientation · (0, 0, 5)`. Vlastní světla (`HemisphereLight` a čelovka), aby kostka byla stínovaná nezávisle na hlavní scéně.

**Geometrie** (čistá funkce `buildViewCube(bevel = 0,25)`, `bevel` ∈ (0, 1), jinak chyba programátora; každá oblast má vlastní vrcholy kvůli ostrému stínování → `positions`, `normals`, `uvs`, `index`, `groups`, bez `three`): kostka s poloviční hranou 1 a zkosenými hranami a rohy. **26 oblastí**:
- 6 stěn: čtverec |u|, |v| ≤ 1 − `bevel` na souřadnici ±1, s UV pro popisek,
- 12 hran: zkosení mezi dvěma stěnami (body s oběma souřadnicemi v ⟨1 − `bevel`, 1⟩), bez popisku (UV (0, 0), materiál bez textury),
- 8 rohů: trojúhelník (všechny tři souřadnice v ⟨1 − `bevel`, 1⟩).

Každá oblast je jedna skupina (`group`) v jedné `BufferGeometry`, klíčem je její **směr** `(sx, sy, sz) ∈ {−1, 0, 1}³ ∖ {0}`, který je zároveň směrem pohledu po kliknutí: `(0, −1, 0)` = front, `(1, −1, 1)` = iso.

**Picking.** `Raycaster` z kamery kostky proti její síti → bod zásahu (kostka je v počátku a neotočená, takže lokální = světové) → čistá funkce `cubeRegionAt(point, bevel) → Vec3`: každá souřadnice s |p| ≥ 1 − `bevel` − 1e-6 dá své znaménko, jinak 0. Bez zásahu → `null`.

**Vzhled.**
- Každá z 26 oblastí má vlastní materiál (`materialIndex` = skupina), hover přebarví jen ten svůj. Stěny s popiskem mají bílý materiál a celou barvu (pozadí stěny nebo hoveru a text) nese jejich `CanvasTexture`, protože `map` se násobí barvou materiálu a v tmavém tématu by text zanikl.
- `MeshStandardMaterial` (jemné stínování), barva stěn z palety `viewCube[0]`. Stěny mají popisek (`CanvasTexture`, text barvou `viewCube[1]`, bezpatkové písmo), hrany a rohy jsou bez textu. Popisek je vzpřímený při pohledu ze standardního pohledu dané stěny (`viewBasis` jejího směru).
- Hovered oblast má barvu `palette.hover`.
- **Průhlednost:** v klidu `opacity` 0,55, když je ukazatel nad překryvem, 1,0. Přechod 150 ms lineárně přes `tick` jako animace kamery. `transparent: true`, `depthWrite: true`, `side: FrontSide` (kostka je konvexní, zadní stěny prosvítat nemají).
- **Osy** X/Y/Z barvami `palette.axes` vychází z rohu (−1, −1, −1) mírně vně kostky (posun 0,12 ven podél úhlopříčky), délka 1,1, na konci písmena X, Y, Z. Přesné rozměry doladí ověření v prohlížeči.
- `setPalette` přebarví i kostku a osy.

**Šipky** (DOM, `<button>` s inline SVG, `aria-label` z popisků): 4 trojúhelníkové šipky uprostřed stran čtverce kostky (`turn` kolem `up` ±1 a `right` ±1) a 2 obloukové šipky v pravém horním rohu překryvu (roll ±1, **jen v režimu `'free'`**, v `'turntable'` skryté a mimo pořadí tabulátoru). Volání `turn` dostává aktuální režim. Viditelné jen při ukazateli nad překryvem nebo při fokusu klávesnicí uvnitř překryvu (`focusin`/`focusout`); CSS `opacity` s přechodem 150 ms. Kostka je pak také neprůhledná. Klik → `animateTo(turn(...))`.

**Tlačítko režimu otáčení** (M17.1): `<button>` 16 px v pravém dolním rohu překryvu, viditelné spolu se šipkami. Ikona (inline SVG) ukazuje **aktuální** režim (turntable: oblouk kolem svislé osy; volný: koule s oblouky), `aria-label` a `title` říká, na co se přepne (`switchToFree` / `switchToTurntable`). Klik → `onOrbitModeToggle` (nic dalšího, režim nastaví až `setOrbitMode` zvenku)

**Události v překryvu.**
- `pointermove` bez tlačítka → hover oblasti (`cubeRegionAt`), změna → `requestRender()`. `pointerleave` → bez hoveru, kostka zprůhlední.
- Levé `pointerdown` na kostce → `setPointerCapture`, zapamatuje start. Posun nad **3 px** od startu = tažení: dál volá `orbit(dx, dy, height)` s výškou **hlavního** plátna (stejná citlivost jako pravé tlačítko ve scéně) a zruší animaci. `pointerup` bez tažení nad oblastí = klik → `animateTo(orientationFor(směr oblasti))`.
- Kolečko a kontextové menu nad překryvem: `preventDefault()`, nic dalšího. Ostatní tlačítka se ignorují.

**Popisky.** `render` nezná i18n. Popisky stěn a `aria-label` šipek přichází hodnotou:

```ts
export type ViewCubeLabelKey =
  | 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom'
  | 'turnLeft' | 'turnRight' | 'turnUp' | 'turnDown' | 'rollClockwise' | 'rollCounterClockwise'
  | 'switchToFree' | 'switchToTurntable';   // M17.1
export type ViewCubeLabels = Readonly<Record<ViewCubeLabelKey, string>>;
```

`createViewport({ …, viewCubeLabels? })` (výchozí anglické, veřejná konstanta `DEFAULT_VIEW_CUBE_LABELS` z `render/index.ts`) a `Viewport.setViewCubeLabels(labels)`. Ten překreslí textury stěn a změní `aria-label`. Stejné hodnoty nic nedělají. `app` je předává z `ui` ([[11-ui#Kompoziční kořen (app)]]).

### Události

- Canvas převádí `pointerdown`/`pointermove`/`pointerup`/`pointerleave` na `ViewPointerEvent` a `keydown` (canvas má `tabIndex = 0`) na `ViewKeyEvent` s `inTextField: false`. Kolečko se nepřeposílá.
- Převod je čistá funkce nad prostými hodnotami (ne DOM typy): `toViewPointerEvent({ type, offsetX, offsetY, button, shiftKey, altKey, ctrlKey, metaKey }, isMac)`. `button` 0/1/2 → `'left'/'middle'/'right'`, u `move` a `leave` `null`. `mod` = `metaKey` na Macu, jinak `ctrlKey`.
- Viewport sám nic nevybírá ani nezvýrazňuje, jen hlásí události.

## Synchronizace s regenerací

```ts
export interface BodyLayer {
  /** Aktualizuje zobrazená tělesa. Splní se, až je scéna vyměněná nebo sync zastaral. Nikdy se neodmítne;
   *  duplicitní BodyId je chyba programátora a vyhodí výjimku synchronně, dřív než se cokoli změní. */
  sync(bodies: readonly { readonly id: BodyId; readonly shape: ShapeHandle }[]): Promise<void>;
  /** Výměna instance jádra: zahodí cache i zobrazená tělesa, zneplatní běžící sync. */
  reset(meshes: MeshOps): void;
}
```

Implementace `SceneSync`:
1. Čistá funkce `diffBodies(shown, next)` porovná nové `(BodyId, ShapeHandle)` se zobrazenými → `{ add, remove, keep }`. Stejné `BodyId` i handle → `keep`. Změněný handle → `remove` i `add`. Duplicitní `BodyId` v `next` je chyba (assert).
2. Pro `add` se sítě berou z `MeshCache` (hodnota `Promise<MeshData>`, takže souběžné požadavky na stejný handle sdílí jedno volání `tessellate`). Kvalita je pevná pro instanci cache, klíčem je proto jen handle. Jiná kvalita nebo nové jádro znamená novou cache. Neúspěšný slib se z cache odstraní, ale jen pokud pod handle pořád leží on (pozdní odmítnutí nesmaže novější požadavek).
3. Jakmile jsou **všechny** sítě dané generace vyřízené (`Promise.allSettled`), vymění scénu najednou v jednom synchronním bloku: odebere a uvolní `BodyView` z `remove`, přidá nové, pak `requestRender()`. Žádné problikávání napůl starého a napůl nového modelu.
4. **Chyba tessellace** ([[Q059 Chyba tessellace v SceneSync|Q059]]): v aktuální generaci → `reportError(body, error)`, těleso se nezobrazí, ostatní se vymění normálně. V zastaralé generaci se chyba zahodí.
5. Pokud mezitím přišel novější `sync` nebo `reset`, výsledek starého se zahodí (vzor generací jako v regeneraci). Zahazují se jen `MeshData`, GPU zdroje ještě nevznikly.
6. Po výměně cache zapomene handle, které v posledním `sync` nejsou (regenerace je uvolnila a nové jádro je znovu nepoužije).
7. **Výměna instance jádra** (restart workeru, [[Q060 Výměna jádra a cache sítí v render|Q060]], [[Q037 Pád workeru a čekající RPC volání|Q037]]): `app` zavolá `reset(newMeshes)` a vynutí plnou regeneraci. Handle jsou jedinečné jen v rámci instance a nové jádro čísluje znovu. Napojení v [[M10-ui|M10]].
8. Logika bodů 1–7 je oddělená od Three.js (`SceneSync`, `scene-sync.ts`): výsledkem je plán `{ remove, add }`, který `BodyLayer` provede synchronně ve funkci `apply`. Plán, který nic nemění, se neprovádí (žádné zbytečné překreslení). `reset` provede plán, který odebere všechna zobrazená tělesa, takže `apply` musí snést volání i mimo `sync`.
9. Po výměně scény `HighlightLayer` přestaví zvýraznění z nových sítí. Cíle, jejichž těleso zmizelo nebo index je mimo rozsah, tiše vypustí. Jestli index po regeneraci ukazuje na „stejnou“ plochu, řeší [[08-topologicke-pojmenovani|topologické pojmenování]] v `interaction` (M14): výběr se přemapuje podle jména a `interaction` pošle nové cíle; `render` jména nezná.

**Vlastnictví GPU zdrojů:** `MeshCache` drží jen `MeshData` (data na CPU). GPU zdroje (`BufferGeometry`, materiály) vlastní výhradně `BodyView`, který je vytvoří a v `dispose()` uvolní. Jeden vlastník, žádné počítání referencí. Sdílené materiály (stejné pro všechna tělesa) vlastní `BodyLayer` a uvolní je ve vlastním `dispose`.

## Reprezentace tělesa

`BodyView` (jedna instance na těleso, vytváří ho `BodyLayer` z `MeshData`):
- `THREE.Mesh` s `BufferGeometry` (index, `position`, `normal`) – plochy, `MeshStandardMaterial`, `polygonOffset` (factor 1, units 1), aby hrany vyhrály nad plochami,
- `THREE.LineSegments` – hrany, tmavé. `edgePositions` jsou polyline (hrana má N bodů, u kvádru 2, od M11 víc). Čistá funkce `polylinesToSegments(edgePositions, edgeRanges)` → `{ positions: Float32Array; segmentEdges: Uint32Array }` je převede na páry úseček a k nim mapu segment → hrana,
- `faceRanges` pro mapování trojúhelník → plocha: čistá funkce `triangleToFace(faceRanges, triangle)` → `faceIndex | undefined`, binární vyhledávání podle `firstTriangle` (vzestupné, zaručuje `validateMeshData`),
- `userData` nese `BodyId` pro picking.

Zvýraznění plochy je **malá vlastní kopie** jejích trojúhelníků: čistá funkce `faceTriangles(mesh, faceIndex)` → neindexované `positions` a `normals` (`Float32Array`). Plocha má desítky až stovky trojúhelníků, kopie je levná a `dispose` nesahá na buffery tělesa. Zvýraznění hrany = kopie jejích segmentů. (Původní návrh „sub-geometrie ze stejných bufferů“ opuštěn: `dispose` geometrie v Three.js uvolní z GPU i sdílené atributy.)

## Vrstvy pro interakci

- `HighlightLayer implements HighlightPort`: hover a výběr mají různé barvy, výběr vyhrává nad hoverem, pokud ukazují na totéž. `setHover`/`setSelection` vždy nahradí celý stav ([[Q058 Kontrakt HighlightPort a OverlayPort|Q058]]) a zavolají `requestRender()`. Volání se stejnou hodnotou jako minule nic nepřekresluje (porovnání podle `kind`, `body`, indexu). Od M9 bere `HighlightTarget` (bez `point` a `normal`, [[Q065 Cíl zvýraznění bez bodu a normály|Q065]]); čisté funkce v `highlight-targets.ts` pracují s ním.
  - Neplatné cíle (těleso není zobrazené, index není klíčem ve `faceRanges`/`edgeRanges`) se vypouští už v `setHover`/`setSelection`, nejen po výměně scény. Porovnání „stejná hodnota“ se dělá až po filtraci. Port to nehlásí: `interaction` může mít ve výběru cíl, který viewport právě nezobrazuje.
  - Plocha: neosvětlený průhledný `MeshBasicMaterial` (opacity 0,45, `depthWrite: false`, `polygonOffset` −1/−1, tedy ke kameře). Stínování tělesa zůstane vidět.
  - Těleso (M14, cíl `{ kind: 'body', body }`): kopie všech trojúhelníků tělesa (`faceTriangles` pro každou plochu ve `faceRanges`, spojené) se stejným materiálem jako zvýraznění plochy; hover na těleso `pick` nevrací, takže jde hlavně o výběr (Prohlížeč, reference `bodies` v dialogu, [[Rozhodnutí noční rychloakce#M14 – Topologické pojmenování|R104]]); `setHover({ kind: 'body', … })` přesto platí a kreslí těleso barvou hoveru. Neplatný cíl = těleso není zobrazené. Porovnání „stejná hodnota“ podle `kind` a `body`.
  - Hrana: **tlusté čáry** `LineSegments2` + `LineMaterial` z `three/addons` (3 px). WebGL kreslí `LineSegments` vždy 1 px široké bez ohledu na `linewidth`, takže by zvýraznění na hraně tělesa zaniklo. `LineMaterial` potřebuje rozlišení plátna, viewport ho předává při každé změně velikosti.
  - Přestavbu po výměně scény spouští `BodyLayer` volbou `afterApply` (volá se v `apply` po výměně, před `requestRender`).
- `OverlayLayer implements OverlayPort`: `OverlayShape` → `LineSegments`/`Points` ve vlastní skupině scény, styly `preview` a `construction` jako dva sdílené materiály. `set(id, …)` uvolní předchozí geometrii pod stejným `id`. `lines` s lichým počtem bodů je chyba (assert), pod `id` pak zůstane předchozí stav. `construction` je čárkovaná (`LineDashedMaterial`).
- Zvýraznění a overlay do pickingu nevstupují. Zvýraznění plochy se kreslí nad plochou tělesa díky `polygonOffset` (u čar a bodů nemá účinek). Hrany zvýraznění a overlay mají `depthTest` zapnutý a vyšší `renderOrder` (zvýraznění 1, overlay 2): na stejné hloubce vyhrají, ale tělesa před nimi je zakryjí.

## Skici

Kresby skic a rovin ([[12-skicar#Kresba a picking]], [[0017-modul-sketch-a-skicar|ADR 0017]]) přicházejí jako `SketchDrawing` přes `SketchPort` ([[10-interakce#Port viewportu]]); `render` je tesseluje a pickuje sám. Data skici ani jádro nezná.

- **Čisté funkce** (bez `three`, test v Node): `tessellateSketch(drawing, maxStep = π/36)` v `sketch-drawing.ts` → světové `segments` (dvojice bodů xyz), `segmentCurves` (id křivky na segment), `segmentStyles`, `points` (xyz), `pointIds`, `pointStyles`; oblouk dostane `max(2, ⌈(endAngle − startAngle) / maxStep⌉)` segmentů, body přes `plane.toWorld`. `pickSketch(screenSegments, screenPoints, x, y, tolerancePx = 6)` v `sketch-pick.ts` → nejbližší bod do tolerance, jinak nejbližší segment (přes `closestSegments`), nebo `null`.
- **`SketchLayer`** (`sketch-layer.ts`): pod každým id jedna skupina s `LineSegments2` (`LineMaterial` s barvami po vrcholech, šířka 2 px) a `Points` (7 px, bez zmenšování se vzdáleností); barva podle stylu z palety: `normal` → `sketch`, `defined` → `sketchDefined`, `construction` a `plane` → `construction`, `hover` → `hover`, `selected` → `selection`. `depthTest: false`, `renderOrder` 3: skica se kreslí přes tělesa (rovina skici často leží na ploše tělesa a čáry by s ní bojovaly o hloubku, [[Rozhodnutí noční rychloakce#M12 – Skicář|R47]] ⚠). `set` nahradí vše pod id a uvolní starou geometrii, `remove` neznámého id nic. `setPalette` přebarví, rozlišení `LineMaterial` dostává jako zvýraznění.
- **Picking:** s `'sketchEntity'` ve filtru se nejdřív zkouší skici (všechny kresby, body před křivkami, bez testu zakrytí tělesy); zásah → `{ kind: 'sketchEntity', sketch: id kresby, entity: id bodu nebo křivky, point }` (`point` = bod na segmentu nebo bod ve 3D). Bez zásahu pokračují hrany a plochy podle filtru. `camera.fitAll` kresby skic nezahrnuje.
- `HighlightLayer` cíle `sketchEntity` vypouští (zvýraznění skici nese styl kresby).
- **Oblasti** (M13, [[Rozhodnutí noční rychloakce#M13 – Extrude a Revolve|R75]]): kresba může nést `regions` (uzavřené polygony v rovině kresby, spočítá je `interaction`). `SketchLayer` z každé oblasti postaví výplň (`ShapeGeometry` z `THREE.Shape` s dírami v souřadnicích roviny, umístěnou rámcem roviny), bez zvýraznění neviditelnou; cíle `sketchRegion` z `HighlightLayer` ji obarví (`hover`, `selection`, průhlednost 0,35, `depthTest: false`, `renderOrder` 2 – pod čarami skici). Picking oblasti je čistá funkce `pickSketchRegion(drawings, ray)` v `sketch-pick.ts`: průsečík paprsku s rovinou kresby (`plane.intersectRay`), `toLocal`, bod v polygonu (`pointInRegion`, sudo-liché pravidlo přes `outer` i `holes`), z více kreseb nejbližší podél paprsku; zakrytí tělesy se nekontroluje (jako R47 ⚠). Zásah → `{ kind: 'sketchRegion', sketch: id kresby, region: id oblasti, point }`.
- **Pořadí v `pick`** podle filtru: `sketchEntity` > `sketchRegion` > hrany > plochy.

## Picking

`PickResult` definuje [[10-interakce#Port viewportu]] ([[Q057 Tvar PickResult|Q057]]).

Filtr (`PickFilter`, [[10-interakce#Port viewportu]], M10.1): průchod přes hrany (bod 2) běží jen s `'edge'` ve filtru, raycast ploch (bod 1) jen s `'face'`; prázdný filtr vrátí `null` bez dotazu na scénu. Výchozí je obojí. Plochy zakrývají hrany i s filtrem `['edge']`: raycast viditelnosti hrany (bod 2) s plochami počítá vždy, filtr vypíná jen výběr ploch jako výsledek.

1. Plochy: `THREE.Raycaster` jen proti meshům těles → první zásah → index trojúhelníku → `triangleToFace` → `faceIndex`. `normal` = normála trojúhelníku z jeho vinutí (proti směru hodinových ručiček při pohledu zvenku = ven, kontrakt [[06-geometricke-jadro|jádra]]) ve světových souřadnicích, **ven z tělesa**, neotáčí se podle paprsku. Orientace roviny skici na ploše (M12) tak nezávisí na tom, odkud se uživatel dívá.
2. Hrany: čistá funkce `closestSegments(screenSegments, x, y, tolerancePx)` nad segmenty promítnutými do pixelů vrátí kandidáty seřazené podle vzdálenosti (tolerance 6 px). Kandidát je viditelný, pokud raycast skrz jeho nejbližší bod nenarazí na plochu blíž než ten bod (tolerance 1e-4 × úhlopříčka scény). První viditelný kandidát vyhrává **před plochou**. `point` = nejbližší bod na segmentu ve 3D.
   - Viditelnost se testuje raycastem s `far` = hloubka bodu − tolerance (tolerance 1e-4 × úhlopříčka sjednocené obálky, nejméně 1e-6 mm). Plochy, které na hraně leží, ji tak nezakryjí.
   - Segment, jehož některý konec leží mimo `near`/`far`, se nepromítne (celý NaN) a nedá se vybrat. Segment jen zčásti mimo pohled zůstává. Od M17 `near`/`far` obalují všechno viditelné a nastavují se i před `pick` (viz [[#Near a far]]), takže viditelné hrany tím nikdy nevypadnou.
   - Hrana viděná z čela (průmět kratší než 1e-3 px, např. svislé hrany kvádru shora) bere bližší konec ke kameře, ne `t = 0`, aby ji nezakryl vlastní vzdálenější konec.
   - Výpočet bodu přes `t` z obrazovky platí jen pro ortografickou kameru. Projekce a raycasty běží při každém `pick`, pro velké modely bude potřeba cache nebo GPU picking (bod 4).
3. Ortografická kamera: paprsek z `screenToRay` má pro celé plátno stejný směr (směr pohledu), počátek leží na blízké rovině.
4. Pro velké modely později GPU picking (render ID do offscreen bufferu). Zatím ne.

## Testy

`render` se testuje nejhůř, proto v něm má být co nejméně logiky ([[Q061 Testy render v Node|Q061]]):
- Čisté funkce leží v souborech **bez importu `three`** (hlídá pravidlo v `.dependency-cruiser.cjs`, protože `three` v Node běží a testy by porušení nepoznaly) a testují se v Node (`tsconfig.test.json` beze změny): `diffBodies`, `triangleToFace`, `polylinesToSegments`, `faceTriangles`, `closestSegments`, `fitOrtho` a směry standardních pohledů, od M17 operace kamery (`orbit`, `pan`, `zoomAt`, `turn`, `ease`, `interpolate`, `clipRange`, `orientationFor`), `cameraGesture`, `wheelFactor`, `buildViewCube` a `cubeRegionAt`, `toViewPointerEvent`/`toViewKeyEvent`, `FrameScheduler`, `meshBounds`/`unionBounds` (obálka pro `fitAll`, počítaná z `positions`), `MeshCache` a generace `SceneSync`, od M12 `tessellateSketch`, `pickSketch` a `viewDirectionFor` (od M17 zaniká), od M13 `pickSketchRegion` a `pointInRegion`, od M15 `parseHexColor` (proti ručnímu `MeshOps` v testu, jehož `tessellate` vrací odložené sliby, které test splní nebo odmítne v libovolném pořadí; bez Three.js – výsledkem je plán výměny, ne scéna).
- Testy `render` nesmí importovat `@/kernel/testing` (`FakeKernel`): `render` závisí na `kernel` jen typově a `testing.ts` otevírá jen hodnotovým závislostem ([[01-architektura]]). Sítě v testech jsou ruční, malé a záměrně s klíči ploch mimo pořadí.
- Kód s Three.js (`Viewport`, `BodyView`, vrstvy, picking) se ověřuje ručně na dev stránce `dev/viewport.html`. Smoke test v prohlížeči (Playwright) později.

## Otevřené otázky

Otázky jsou samostatné poznámky v `60-otazky/` a odkazují sem. Novou otázku založ šablonou *Otázka*.

![[otazky.base#Otázky k této poznámce]]
