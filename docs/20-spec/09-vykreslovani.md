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
  - "[[M22-rezimy-zobrazeni]]"
  - "[[M23-postprocessing-a-ao]]"
  - "[[M24-realisticke-zobrazeni]]"
tags:
  - spec
created: 2026-10-12
updated: 2026-10-15
---
# 09 – `render`: vykreslování

> **Pojmy:** [[Viewport]], [[Handle tvaru]], [[Těleso]], [[Styl zobrazení]]  
> **Milník:** [[M08-vykreslovani]], kamera a view cube [[M17-kamera-a-view-cube]], režimy zobrazení [[M22-rezimy-zobrazeni]]  
> **Rozhodnutí:** [[0019-vlastni-ovladani-kamery|ADR 0019]], [[0020-rezim-otaceni-kamery|ADR 0020]], [[0026-viceprochodove-vykreslovani-ve-viewportu|ADR 0026]]

Zobrazuje výsledek regenerace pomocí Three.js a odpovídá na otázku „co je pod kurzorem“. O dokumentu ani featurách neví nic – pracuje s tělesy (`BodyId`), handle a sítěmi. Závisí na `core`, typech z `kernel`, typech z `interaction` (port `ViewportPort`, události a `BodyId`, [[0009-platformove-nezavisla-domena|ADR 0009]]) a knihovně `three`.

## Závislost

`three` ~0.186 a `@types/three` ~0.186 (dev). Z `kernel` bere `render` jen typy `MeshData`, `MeshOps`, `MeshQuality`, `ShapeHandle` a `BoundingBox`. Three.js má verze `0.x`, minor vydání může rozbít API, proto `~`. Z `three/addons` (podcesta stejného balíku) jen `LineSegments2`/`LineMaterial` a od M23 postprocessing `EffectComposer`, `RenderPass`, `GTAOPass`, `OutputPass`, `Pass`/`FullScreenQuad` a `GTAOBlendShader` ([[#Víceprůchodové vykreslování (AO)]]). `OrbitControls` se do [[M17-kamera-a-view-cube|M17]] používaly pro kameru, od M17 je nahradilo vlastní ovládání ([[0019-vlastni-ovladani-kamery|ADR 0019]]). Nové ADR není potřeba, Three.js zvolil [[0001-jadro-v-cistem-ts|ADR 0001]] ([[Q062 Závislost three a OrbitControls|Q062]]).

## Viewport

```ts
export interface Viewport extends ViewportPort, Disposable {
  mount(el: HTMLElement): void;        // vytvoří canvas, renderer, ResizeObserver, ovládání kamery; podruhé bez unmount = chyba
  unmount(): void;                     // uvolní renderer a canvas, scéna (tělesa, kamera) zůstává; idempotentní

  requestRender(): void;               // vykreslení na požádání, ne smyčka 60 fps
  pick(x: number, y: number, filter?: PickFilter): PickResult | null;   // px vůči canvasu (CSS px); nepřipojený viewport → null; filtr viz spec 10
  screenToRay(x: number, y: number): { origin: Vec3; direction: Vec3 };  // nepřipojený → chyba

  readonly bodies: BodyLayer;          // tělesa z regenerace; reset(meshes) vyprázdní i náhled
  readonly preview: PreviewLayer;      // M21: náhled editované featury (viz Náhled)
  syncLayers(next: { main: readonly ShownBody[]; preview: readonly ShownBody[] }): Promise<void>;   // M21: obě vrstvy atomicky (viz Náhled)
  readonly highlight: HighlightLayer;  // hover a výběr (implementuje HighlightPort)
  readonly overlay: OverlayLayer;      // dočasná geometrie nástrojů (implementuje OverlayPort)
  readonly sketches: SketchLayer;      // kresby skic a rovin (implementuje SketchPort, M12)
  readonly manipulators: ManipulatorLayer;   // úchyty manipulátorů (implementuje ManipulatorPort, M18)
  readonly camera: CameraController;   // fit all, standardní pohledy, kolmo na rovinu (M12)
  sketchGridStep(): number;            // M19.2: krok mřížky skici v mm podle velikosti pixelu posledního snímku; před prvním snímkem 1 (viz Skici)

  setPalette(palette: ScenePalette): void;   // přebarví existující materiály, nic nevytváří znovu (Q072)
  setBodyVisible(body: BodyId, visible: boolean): void; // stav pohledu z Prohlížeče (Q071)
  setBodyColor(body: BodyId, color: string | null): void; // M15: '#rrggbb' z metadat tělesa, null = barva palety
  setViewCubeLabels(labels: ViewCubeLabels): void;       // M17: popisky stěn a šipek view cube (viz View cube)
  setOrbitMode(mode: OrbitMode): void;                    // M17.1: režim otáčení (viz Kamera → Režim otáčení); stejná hodnota = nic
  onOrbitModeToggle(listener: () => void): Unsubscribe;   // M17.1: klik na tlačítko režimu u view cube; dispose odběratele uvolní
  setDisplayStyle(style: DisplayStyle): void;             // M22: styl zobrazení (viz Styl zobrazení); stejný plán = nic
  setAoSettings(settings: AoSettings): void;              // M23: nastavení AO (viz Víceprůchodové vykreslování); stejné hodnoty = nic

  readonly events: Subscribable<{ pointer: ViewPointerEvent; key: ViewKeyEvent }>;
}

export function createViewport(deps: {
  meshes: MeshOps;
  quality?: MeshQuality;                              // výchozí MESH_QUALITY
  palette?: ScenePalette;                             // výchozí LIGHT_PALETTE (nahrazuje background)
  reportError?: (body: BodyId, error: unknown) => void;  // výchozí console.error
  viewCubeLabels?: ViewCubeLabels;                    // výchozí anglické
  now?: () => number;                                 // hodiny animací, výchozí performance.now
  manipulatorGlyphs: ManipulatorGlyphs;               // z interaction/constants.ts, dodá app (viz Manipulátory)
  handleVisibility: HandleVisibility;                 // dtto
}): Viewport;

export const MESH_QUALITY: MeshQuality = { linearDeflection: 0.1, angularDeflection: 0.5 };

/** Barvy scény jako 0xRRGGBB. Hodnota, žádné CSS – render nezná DOM (Q072). */
export interface ScenePalette {
  readonly background: number;
  readonly face: number;
  readonly edge: number;
  readonly hover: number;       // světlejší odstín výběru: světlá 0xfb923c, tmavá 0xffc266
  readonly selection: number;   // oranžová (M19.2 D1): světlá 0xea580c, tmavá 0xff9f0a; ne --accent v CSS
  readonly preview: number;     // overlay nástrojů (gumové čáry skicáře, modré jako skica)
  readonly bodyPreview: number; // M21: náhled editované featury, jantarová: světlá #b07d0a (kontrast 3,3 : 1), tmavá #ffd60a
  readonly construction: number;
  readonly sketch: number;          // nedourčená skica (M12): světlá 0x0a84ff, tmavá 0x409cff
  readonly sketchDefined: number;   // plně určená skica (M12): světlá 0x1c1c1e, tmavá 0xf2f2f7
  readonly axes: readonly [x: number, y: number, z: number];   // obě palety 0xff3b30, 0x34c759, 0x0a84ff (mockup)
  readonly grid: readonly [center: number, line: number];
  readonly viewCube: readonly [face: number, text: number];   // M17: světlá 0xffffff, 0x374151; tmavá 0x4b4f57, 0xe5e7eb
  readonly hiddenEdge: number;  // M22: čárkované skryté hrany; světlá 0x8b929c, tmavá 0x6b7280
  readonly meshLine: number;    // M22: čáry triangulace; světlá 0x8e99a8, tmavá 0x5a7fb0
}
export const LIGHT_PALETTE: ScenePalette;
export const DARK_PALETTE: ScenePalette;
```

- Typy portu (`ViewportPort`, `PickResult`, `HighlightTarget`, `HighlightPort`, `OverlayPort`, události, `BodyId`) definuje [[10-interakce#Port viewportu]], `render` je importuje jen jako typy z `@/interaction`.
- `mount`, `bodies` a `camera` nejsou součástí portu: používá je jen `app` (kompoziční kořen). Nástroje vidí jen `ViewportPort`.
- `dispose()`: `unmount()`, uvolní všechna tělesa, zvýraznění, overlay, ovládání kamery a odběratele `events`. Další volání čehokoli kromě `dispose` je chyba, i na podobjektech (`bodies`, `camera`, `highlight`, `overlay`, `events.on`).
- Barvy scény jsou jen v `ScenePalette` ([[Q072 Barvy scény podle režimu|Q072]]): konstanty `FACE_COLOR`, `EDGE_COLOR`, barvy ve `highlight-layer`, `overlay-layer` a `scene-helpers` se nahradí čtením z palety. `setPalette` změní barvy materiálů a pozadí a zavolá `requestRender()`. Paletu vybírá `app` podle režimu, který mu předá `ui` (`AppSession.viewSettings.setTheme`, [[11-ui]]); `ui` typy z `render` nezná.
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

Před každým snímkem (`draw`) a před každým `pick`/`screenToRay` rig nastaví `position`, `near`, `far` podle `clipRange` nad **obálkou všeho viditelného**: viditelná tělesa (`BodyLayer.bounds()`), kresby skic včetně mřížky skici (`SketchLayer.bounds()`; `setPixelSize` proto běží ve `draw` před `updateClip()`), overlay nástrojů (`OverlayLayer.bounds()`, nové), úchyty manipulátorů (M18), mřížka (±100 mm v z = 0) a cíl kamery. Žádná situace (posun a otočení, zoom ke kurzoru, nové těleso bez `fitAll`, skica mimo tělesa) tak model neořízne. U ortografické kamery mění `near`/`far` jen hloubkový řez, ne velikost obrazu.

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

**Rozvržení.** Viewport v `mount` vloží do `el` (rodič s `position` jinou než `static`; `ViewportHost` má `absolute`) překryvný `div` 132 × 132 CSS px, 8 px od pravého a horního okraje. Uprostřed je čtverec 96 × 96 px, do kterého se kreslí kostka. Kolem něj jsou šipky. Kořen překryvu má `pointer-events: none` (M19.2 D13). Vstup berou jen průhledný prvek 96 × 96 px nad čtvercem kostky (`INSET` od okraje) a tlačítka šipek a režimu (`pointer-events: auto`). Nad nimi se události nedostanou k canvasu ani k výběru v `interaction`. Jinde ve čtverci 132 × 132 px jde vstup do viewportu (kolečko zoomuje, pravé tažení otáčí). Posluchače jsou na kořeni, události prvku kostky a tlačítek k němu doputují bublinou.

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
- **Průhlednost:** v klidu `opacity` 0,55, když je ukazatel nad kostkou nebo jejími tlačítky, 1,0. Přechod 150 ms lineárně přes `tick` jako animace kamery. `transparent: true`, `depthWrite: true`, `side: FrontSide` (kostka je konvexní, zadní stěny prosvítat nemají).
- **Osy** X/Y/Z barvami `palette.axes` vychází z rohu (−1, −1, −1) mírně vně kostky (posun 0,12 ven podél úhlopříčky), délka 1,1, na konci písmena X, Y, Z. Přesné rozměry doladí ověření v prohlížeči.
- `setPalette` přebarví i kostku a osy.

**Šipky** (DOM, `<button>` s inline SVG, `aria-label` z popisků): 4 trojúhelníkové šipky uprostřed stran čtverce kostky (`turn` kolem `up` ±1 a `right` ±1) a 2 obloukové šipky v pravém horním rohu překryvu (roll ±1, **jen v režimu `'free'`**, v `'turntable'` skryté a mimo pořadí tabulátoru). Volání `turn` dostává aktuální režim. Viditelné jen při ukazateli nad kostkou nebo tlačítky (`pointerenter`/`pointerleave` kořene, tlačítka berou pointer i neviditelná) nebo při fokusu klávesnicí uvnitř překryvu (`focusin`/`focusout`); CSS `opacity` s přechodem 150 ms. Kostka je pak také neprůhledná. Klik → `animateTo(turn(...))`.

**Tlačítko režimu otáčení** (M17.1): `<button>` 16 px v pravém dolním rohu překryvu, viditelné spolu se šipkami. Ikona (inline SVG) ukazuje **aktuální** režim (turntable: oblouk kolem svislé osy; volný: koule s oblouky), `aria-label` a `title` říká, na co se přepne (`switchToFree` / `switchToTurntable`). Klik → `onOrbitModeToggle` (nic dalšího, režim nastaví až `setOrbitMode` zvenku)

**Události v překryvu.**
- `pointermove` bez tlačítka → hover oblasti (`cubeRegionAt`), změna → `requestRender()`. `pointerleave` → bez hoveru, kostka zprůhlední.
- Levé `pointerdown` na kostce → `setPointerCapture` na prvku kostky, zapamatuje start. Posun nad **3 px** od startu = tažení: dál volá `orbit(dx, dy, height)` s výškou **hlavního** plátna (stejná citlivost jako pravé tlačítko ve scéně) a zruší animaci. `pointerup` bez tažení nad oblastí = klik → `animateTo(orientationFor(směr oblasti))`.
- Kolečko a kontextové menu nad kostkou a tlačítky: `preventDefault()`, nic dalšího. Jinde v překryvu je kořen nechytí a dostane je canvas. Ostatní tlačítka se ignorují.

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
- Levé `pointerdown` zavolá `canvas.setPointerCapture(pointerId)` (M18), aby tažení manipulátoru pokračovalo i mimo canvas. `pointerup` zachycení uvolní sám prohlížeč. Pravé a prostřední tlačítko zachycuje dál `CameraInput`. `pointercancel` (systém tah přerušil) se přepošle jako `up` s tlačítkem `left`, aby tažení manipulátoru neuvízlo. `lostpointercapture` se nepřeposílá: chodí i po každém běžném `pointerup` a `SelectTool` by viděl klik dvakrát.
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

**Sdílená cache a výměna jádra** ([[M21-vstupni-stav-editovane-featury|M21]]): sítě drží jedna sdílená cache `createSharedMeshCache(meshes, quality)` a každá vrstva těles (hlavní a náhled) je její klient. `retain` jedné vrstvy drží sjednocení toho, co potřebují všechny vrstvy, a handle běžícího `sync` zůstává v cache až do dalšího `retain` téže vrstvy. Stejný handle se tak tesseluje jednou, i když je v obou vrstvách. `SceneSync` dostává cache zvenku a místo `reset(meshes)` má `clear()`. Výměnu jádra dělá vlastník cache (`BodyLayers`): `reset` cache, pak `clear()` obou vrstev. `Viewport.bodies.reset(meshes)` proto vyprázdní i náhled.

## Náhled

[[0025-vstupni-stav-editovane-featury|ADR 0025]]: během editace featury hlavní vrstva ukazuje vstup editované featury a výsledek je přes něj jako průhledný náhled.

```ts
export interface PreviewLayer {
  sync(bodies: readonly { readonly id: BodyId; readonly shape: ShapeHandle }[]): Promise<void>;
  clear(): void;                                 // odebere a uvolní náhled
}
Viewport.preview: PreviewLayer                   // po dispose viewportu vyhodí jako bodies
```

- Druhá vrstva těles (`BodyLayers` drží `main` a `preview`) s vlastní mapou podle `BodyId`, takže vstup i výsledek mohou mít totéž `BodyId`. Které těleso do náhledu patří, vybírá `app` ([[11-ui]]), `render` dostane tělesa už vybraná.
- **Materiály** (`BodyStyle 'preview'`): plochy `MeshStandardMaterial` v barvě `palette.bodyPreview`, `transparent`, `opacity` 0,35, `depthWrite: false`, `polygonOffset` **ke kameře** (factor −1, units −4): změněné těleso sdílí většinu ploch se vstupem a dvě triangulace téže roviny by se jinak přetahovaly o hloubku (z-fighting, nalezeno ručním ověřením M21); hrany neprůhledné v barvě `palette.bodyPreview`; `renderOrder` 0,5 (nad tělesy, pod zvýrazněním). `setPalette` přebarví. Těleso s vlastní barvou dostane průhlednou kopii materiálu.
- **Nepickuje se a nezvýrazňuje:** picker a `HighlightLayer` čtou jen hlavní vrstvu. Náhled blíž ke kameře těleso pod sebou nezakryje.
- **Skrytí a barvy** podle `BodyId` (`setBodyVisible`, `setBodyColor`) platí pro obě vrstvy. Těleso, které v náhledu ještě není, se ignoruje a skrytí a barvu mu doplní `ViewportMirror.reapply()` po dalším `sync`.
- **Barva** `bodyPreview` je jantarová, odlišná od modrých těles (`face`), od oranžové výběru a hoveru i od modrých gumových čar nástrojů (`preview`), s kontrastem aspoň 3 : 1 vůči pozadí (test palety). Přes modré těleso dává olivový nádech; co featura odebere, zůstane vidět modře.
- **Obálka** pro near/far a `fitAll` zahrnuje viditelná tělesa obou vrstev.
- **Atomická výměna obou vrstev** (`syncLayers`, revize M21): `SceneSync` má dvě fáze, `prepare(bodies): Promise<PreparedSync>` (sítě se vyžádají synchronně) a `commit()` (výměna scény; zastaralý nebo už provedený commit nic nedělá). `syncLayers({ main, preview })` zkontroluje duplicity v obou vrstvách, připraví obě a teprve když jsou obě aktuální, provede v jednom synchronním bloku `main.commit()` a `preview.commit()`. Viewport tak nikdy neukazuje novou hlavní vrstvu se starým snapshotem (index a jméno ze stejné generace, D3 z [[M19.1-opravy-z-revize|M19.1]]). Zastaralým ho udělá novější `sync`, `syncLayers`, `preview.clear` nebo `reset` kterékoli vrstvy; pak se nevymění ani jedna. Nikdy neodmítne. Prázdný `preview` náhled vyprázdní v témže `commit`, takže se při zavření dialogu sítě výsledku nezahodí ze sdílené cache a neproblikne to.

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
  - Plocha: neosvětlený průhledný `MeshBasicMaterial` (opacity výběru 0,7, hoveru 0,5, `depthWrite: false`, `polygonOffset` −1/−1, tedy ke kameře). Stínování tělesa zůstane vidět.
  - Těleso (M14, cíl `{ kind: 'body', body }`): kopie všech trojúhelníků tělesa (`faceTriangles` pro každou plochu ve `faceRanges`, spojené) se stejným materiálem jako zvýraznění plochy; hover na těleso `pick` nevrací, takže jde hlavně o výběr (Prohlížeč, reference `bodies` v dialogu, [[Rozhodnutí noční rychloakce#M14 – Topologické pojmenování|R104]]); `setHover({ kind: 'body', … })` přesto platí a kreslí těleso barvou hoveru. Neplatný cíl = těleso není zobrazené. Porovnání „stejná hodnota“ podle `kind` a `body`.
  - Hrana: **tlusté čáry** `LineSegments2` + `LineMaterial` z `three/addons` (3 px). WebGL kreslí `LineSegments` vždy 1 px široké bez ohledu na `linewidth`, takže by zvýraznění na hraně tělesa zaniklo. `LineMaterial` potřebuje rozlišení plátna, viewport ho předává při každé změně velikosti.
  - Přestavbu po výměně scény spouští `BodyLayer` volbou `afterApply` (volá se v `apply` po výměně, před `requestRender`).
- `OverlayLayer implements OverlayPort`: `OverlayShape` → `LineSegments`/`Points` ve vlastní skupině scény, styly `preview` a `construction` jako dva sdílené materiály. `set(id, …)` uvolní předchozí geometrii pod stejným `id`. `lines` s lichým počtem bodů je chyba (assert), pod `id` pak zůstane předchozí stav. `construction` je čárkovaná (`LineDashedMaterial`).
- Zvýraznění a overlay do pickingu nevstupují. Zvýraznění plochy se kreslí nad plochou tělesa díky `polygonOffset` (u čar a bodů nemá účinek). Hrany zvýraznění a overlay mají `depthTest` zapnutý a vyšší `renderOrder` (zvýraznění 1, overlay 2): na stejné hloubce vyhrají, ale tělesa před nimi je zakryjí.

## Styl zobrazení

> **Pojem:** [[Styl zobrazení]] · **Milníky:** [[M22-rezimy-zobrazeni|M22]] (čárové režimy, průhlednost, triangulace), [[M23-postprocessing-a-ao|M23]] (AO, cíl), [[M24-realisticke-zobrazeni|M24]] (Realistic, cíl)

Jak se kreslí tělesa. Je to předvolba stránky jako režim otáčení: zdroj pravdy je `ui` (uloží ji), `app` ji předá přes `ViewSettings.setDisplayStyle` ([[11-ui#Kompoziční kořen (app)]]) a viewport ji jen použije. Do dokumentu ani logu operací nepatří. Liší se od průhlednosti *tělesa*, kterou [[Q073 Průhlednost a barva těles|Q073]] odložila: tady jde o průhlednost celé scény jako pomůcku pohledu.

### Hodnota a plán (`display-style.ts`, bez `three`)

```ts
export type DisplayMode = 'shaded' | 'hiddenRemoved' | 'hiddenVisible' | 'wireframe';   // M24: + 'realistic'
export const DISPLAY_MODES: readonly DisplayMode[];   // pořadí v menu, tak jak je výčet výše

export interface DisplayStyle {
  readonly mode: DisplayMode;
  readonly edges: boolean;        // hrany B-rep; platí jen v 'shaded'
  readonly transparent: boolean;  // platí jen v 'shaded'
  readonly mesh: boolean;         // čáry triangulace; platí ve všech režimech
  readonly ao: boolean;            // M23: ambient occlusion; platí jen v 'shaded' bez průhlednosti (M24: i v 'realistic')
}
export const DEFAULT_DISPLAY_STYLE: DisplayStyle;   // { mode: 'shaded', edges: true, transparent: false, mesh: false, ao: false }
export const TRANSPARENT_FACE_OPACITY = 0.35;

/** Plochý plán: jediné, podle čeho se render rozhoduje. Zmrazený. */
export interface DisplayPlan {
  readonly faces: 'lit' | 'flat' | 'hidden';   // M24: + 'physical'
  readonly faceOpacity: number;                // 1, nebo TRANSPARENT_FACE_OPACITY
  readonly edges: boolean;                     // viditelné hrany B-rep
  readonly hiddenEdges: 'none' | 'dashed';     // druhý průchod hran za plochami
  readonly meshLines: boolean;
  readonly xray: boolean;                      // picking nekontroluje zákryt, zvýraznění bez testu hloubky
  readonly ao: boolean;                        // M23: průchod AO (viz Víceprůchodové vykreslování)
}
export function resolveDisplay(style: DisplayStyle): DisplayPlan;
export function samePlan(a: DisplayPlan, b: DisplayPlan): boolean;
```

Pole, které v daném režimu neplatí, se **ignoruje, ale nemaže**: po návratu do Shaded platí, co bylo nastavené. `resolveDisplay` je jediné místo, kde se rozhoduje podle režimu. Zbytek `render` čte jen plán.

### Rozhodovací tabulka

| Režim (`mode`) | `faces` | `faceOpacity` | `edges` | `hiddenEdges` | `xray` | `ao` | Milník |
|---|---|---|---|---|---|---|---|
| `shaded` | `lit` | 1 | `style.edges` | `none` | ne | `style.ao` | M22, `ao` M23 |
| `shaded`, `transparent` | `lit` | 0,35 | `style.edges` | `none` | **ano** | ne | M22 |
| `hiddenRemoved` | `flat` | 1 | ano | `none` | ne | ne | M22 |
| `hiddenVisible` | `flat` | 1 | ano | `dashed` | **ano** | ne | M22 |
| `wireframe` | `hidden` | 1 | ano | `none` | **ano** | ne | M22 |
| `realistic` (cíl) | `physical` | 1 | ne | `none` | ne | `style.ao` | M24 |

`meshLines = style.mesh` ve všech řádcích. `ao` je jinde `false`: v průhledném `shaded` plochy hloubku nezapisují a AO z hloubky by kreslilo tmavé skvrny pod nimi, v čárových režimech nejsou osvětlené plochy, které by stínilo. `samePlan` porovnává i `ao`. Ve `wireframe` a v průhledném `shaded` plochy hloubku nezapisují, takže hrany za nimi jsou vidět bez druhého průchodu (`hiddenEdges: 'none'`), a proto je tam i `xray`.

### Materiály (`BodyMaterials`, sdílí `BodyLayer`)

- `faces` (`lit`): dnešní `MeshStandardMaterial`. Při `faceOpacity < 1`: `transparent: true`, `opacity`, `depthWrite: false`. Při `1` zpět `transparent: false`, `depthWrite: true`. Změna `transparent` vyžaduje `needsUpdate = true`.
- `facesFlat` (`flat`): `MeshBasicMaterial` v `palette.background`, zapisuje hloubku, `polygonOffset` 1/1 jako `faces`, aby hrany na ploše vyhrály.
- `facesHidden` (`hidden`): `MeshBasicMaterial` s `colorWrite: false` a `depthWrite: false`. Objekt **zůstává `visible`**: raycast pickingu ho dál zasahuje (plochy jdou vybrat ve všech režimech) a obálka a ořez kamery se nemění.
- `hiddenEdges`: `LineDashedMaterial` v `palette.hiddenEdge`, `depthFunc: GreaterDepth`, `depthWrite: false`.
- `meshLines`: `LineBasicMaterial` v `palette.meshLine`.
- `setPalette` přebarví i `facesFlat`, `hiddenEdges` a `meshLines`. `dispose` je uvolní.

### Barvy těles

Materiály podle barvy (`setBodyColor`, M15) žijí dál bez ohledu na plán, plán jen rozhoduje, který materiál pohled dostane: `lit` → materiál barvy (nebo `faces`, když těleso barvu nemá), `flat` → `facesFlat`, `hidden` → `facesHidden`. Barva se v `flat` a `hidden` neztrácí, po návratu do `lit` platí. Průhlednost (`opacity`, `transparent`, `depthWrite`) se nastavuje na `faces` **i na všech materiálech barev**, včetně materiálu barvy vytvořeného až po přepnutí (`acquireColor` klonuje z aktuálního `faces`).

### Skryté hrany

`BodyView` má třetí objekt `hiddenEdges: THREE.LineSegments`, který **sdílí geometrii** s `edges` (jeden buffer na GPU, dva způsoby kreslení). `lineDistance` pro čárky se spočítá při vytvoření pohledu (`computeLineDistances`). `renderOrder` 0,5: kreslí se po všech plochách (0), jejichž hloubku porovnává, a před zvýrazněním (1). Viditelný jen při `hiddenEdges: 'dashed'`.

**Čárky v pixelech:** `LineDashedMaterial` měří `dashSize`/`gapSize` ve světových jednotkách, takže by se při zoomu ortografické kamery čárky slévaly nebo rozpadaly. `BodyLayerInternal.setPixelSize(worldPerPx)` je přepočítá na 6 px čárky a 4 px mezery. Viewport ji volá v `draw()` vedle `sketchLayer.setPixelSize`. Stejná hodnota nic nemění, překreslení nevyvolá (volá se uvnitř snímku).

### Triangulace

`BodyView.setMeshLines(material | null)`: při prvním zapnutí postaví `WireframeGeometry` z geometrie ploch a přidá `LineSegments` do skupiny tělesa. Při `null` ho odebere a geometrii **uvolní** (velké modely mají statisíce hran trojúhelníků, nedrží se zbytečně). `dispose` pohledu je uvolní také. Čáry triangulace do pickingu nevstupují. Hloubku proti plochám řeší stávající `polygonOffset` ploch.

**Silnější hrany při triangulaci** (Pavel 2026-10-15, po ručním ověření): čáry triangulace mají 1 px jako hrany B-rep, takže se v nich hrany ztrácely. Při `plan.meshLines && plan.edges` se proto hrany B-rep kreslí silněji a tenké `edges` se skryjí:

- `BodyView.setThickEdges(material: LineMaterial | null)`: při prvním zapnutí postaví `LineSegments2` z pozic `edges` (`LineSegmentsGeometry.setPositions`) a přidá ho do skupiny tělesa. `null` ho odebere a geometrii uvolní, `dispose` pohledu také. Do pickingu nevstupuje (picking hran počítá ze sítě, ne z objektů).
- `BodyMaterials.edgesThick: LineMaterial` v barvě hran (`edgeColor`), `linewidth` `THICK_EDGE_PX = 2` (pixely, `worldUnits: false`). `setPalette` ho přebarví, `dispose` uvolní.
- `LineMaterial` potřebuje rozlišení: `BodyLayerInternal.setResolution(width, height)` a `BodyLayers.setResolution` (jen `main`). Viewport ho volá vedle `highlightLayer.setResolution`. Funguje i před prvním voláním (výchozí rozlišení `LineMaterial`).
- `applyPlan`: `edges.visible = plan.edges && !plan.meshLines`, silné hrany podle `plan.edges && plan.meshLines`. Skryté hrany (`hiddenEdges`) zůstávají tenké a čárkované.
- `renderOrder` silných hran jako u `edges` (`materials.renderOrder`).

### `BodyLayerInternal`

```ts
setDisplayPlan(plan: DisplayPlan): void;   // samePlan s minulým → nic; jinak přepne všechny pohledy a requestRender()
setPixelSize(worldPerPx: number): void;    // délka čárek skrytých hran (viz výše)
setResolution(width: number, height: number): void;   // rozlišení silných hran při triangulaci (LineMaterial); nepřekresluje
```

Pohled vytvořený v `apply` po přepnutí dostane aktuální plán. Výchozí plán je `resolveDisplay(DEFAULT_DISPLAY_STYLE)`.

**Dvě vrstvy těles (od [[M21-vstupni-stav-editovane-featury|M21]], [[0025-vstupni-stav-editovane-featury|ADR 0025]]):** styl platí jen pro **hlavní vrstvu** (`BodyLayers.main`). Náhledová vrstva (`preview`, průhledná v barvě náhledu) má vlastní vizuální roli jako overlay a skici, takže vypadá ve všech režimech stejně a plán ani `setPixelSize` nedostává. Rozhraní `BodyLayers` proto má `setDisplayPlan`, `setPixelSize` a `setResolution` a všechny jen předá `main`. Materiály stylu (`facesFlat`, `facesHidden`, `hiddenEdges`, `meshLines`, `edgesThick`) vznikají i pro náhledovou vrstvu, ale náhled je nikdy nepoužije. Je to levné a vrstvy zůstávají stejné.

### Picking a zvýraznění

- **„Co vidíš, to vybereš“:** `Picker` dostane volbu `xray: () => boolean` (z aktuálního plánu). Při `true` se přeskočí **všechny** kontroly zákrytu (hrany těles, entity a oblasti skic; skici přes `Picker.isVisible`, které při `xray` vrací `true`). Pořadí průchodů se nemění: hrana v toleranci vyhrává nad plochou pod kurzorem, i když je plocha blíž ke kameře. Z hran v toleranci vyhrává ta **nejblíž kurzoru** v px. Kandidáti do 1 px od nejlepšího se berou jako překrývající se a mezi nimi vyhraje ten nejblíž ke kameře ([[Q080 Výběr hrany v režimu xray|Q080]]). Entity skic si nechávají své pořadí (bod před křivkou, pak px, `betterSketchHit`), xray jim jen vypne zákryt. Plochy se vybírají dál raycastem (nejbližší zásah). Při `false` beze změny.
- `HighlightLayerInternal.setXray(on)`: zvýraznění ploch, těles i hran má `depthTest = !on`, takže je vidět i vybraná zadní hrana. Platí i pro cíle vytvořené po přepnutí (materiály vzhledu jsou sdílené). Stejná hodnota nic nepřekresluje, změna zavolá `requestRender()`.
- Skici, overlay, manipulátory, mřížka, view cube a náhledová vrstva (M21) se stylem nemění.

### `Viewport.setDisplayStyle(style)`

`resolveDisplay(style)`. Při stejném plánu jako minule nic, jinak vnitřní `BodyLayers.setDisplayPlan` (jen `main`; veřejné `Viewport.bodies` tu metodu nemá), `highlight.setXray(plan.xray)`, uložení plánu pro picker a naplánování snímku (`scheduleFrame`, před `mount` prázdné). Funguje i před `mount` (plán platí od prvního snímku). Plán vlastní **viewport**: počáteční plán předá vrstvám těles při jejich vytvoření (`initialPlan`), vrstvy si výchozí plán samy neskládají. Od M23: když nový plán má `ao: false` a pipeline AO existuje, uvolní ji. Parametry AO nastavuje zvlášť `setAoSettings` (viz níže). Zapnutí AO jen naplánuje snímek, pipeline vznikne v `draw()` ([[#Víceprůchodové vykreslování (AO)]]).

### Známá omezení

- **Průhlednost** řadí Three.js po objektech (tělesech), ne po trojúhelnících. Vnitřní stěny konkávního tělesa se mohou prolnout v nesprávném pořadí. Order-independent transparency (depth peeling, weighted blended OIT) je mimo rozsah M22.
- **Siluety zakřivených ploch** se nekreslí. Čárové režimy (`hiddenRemoved`, `hiddenVisible`, `wireframe`) ukazují jen hrany B-rep, takže válec má jen kružnice a šev a jeho boční obrys chybí (ruční ověření M22). Onshape siluety dopočítává podle pohledu. Je to práce navíc mimo rozsah M22 (výpočet podle směru pohledu na síti nebo HLR v jádře).
- V tmavém tématu mají čárkované skryté hrany (`hiddenEdge` 0x6b7280) nižší kontrast než ve světlém. Jsou čitelné, ale slabé.
- Ve `hiddenVisible` kryjí plochy skicu stejně jako v `shaded`, ale picking skic zakrytí nekontroluje (`xray`). Je to vědomá nekonzistence, protože skica za tělesem je při editaci vidět slabě (M19.2).
- **AO (M23):** G-buffer normál je bez MSAA, takže okraj AO na obrysu může být mírně zubatý. S AO se scéna kreslí třikrát ([[0026-viceprochodove-vykreslovani-ve-viewportu|ADR 0026]]).
- **Hrany s AO jsou o něco světlejší a tenčí:** MSAA render targetu průměruje vzorky v lineárním prostoru, MSAA plátna v sRGB. Tmavá jednopixelová čára tak po převodu vyjde světlejší (v testu 105 místo 88). Pavel to při ručním ověření M23 přijal.

### Víceprůchodové vykreslování (AO)

> **Rozhodnutí:** [[0026-viceprochodove-vykreslovani-ve-viewportu|ADR 0026]], [[Q077 Technika AO|Q077]] · **Milník:** [[M23-postprocessing-a-ao|M23]]

Při `plan.ao === false` kreslí `draw()` jako v M22: `renderer.clear()`, jeden `renderer.render(scene, camera)` na plátno s MSAA, pak view cube. Při `plan.ao === true` kreslí místo `renderer.render` **pipeline AO** a view cube zůstává až po ní.

**Průchody** (vše do jednoho render targetu composeru, `HalfFloatType`, `samples: 4`; žádný průchod kromě výstupu nestřídá buffery, `needsSwap = false`):

| # | Průchod | Co kreslí | Skryté skupiny | Mazání |
|---|---|---|---|---|
| 1 | model (`RenderPass`) | hlavní vrstva těles | interakce | barva (`palette.background`) i hloubka |
| 2 | AO (`AoPass`, obal `GTAOPass`) | G-buffer normál a hloubky modelu → AO → odšumění → **násobení** barvy targetu | interakce a `LineSegments2` modelu (jen v G-bufferu) | G-buffer vlastní, target ne |
| 3 | interakce (`RenderPass`, `clear: false`) | náhled, zvýraznění, overlay, skici, manipulátory, mřížka | model | nic, hloubka modelu zůstává |
| 4 | výstup (`OutputPass`) | převod do sRGB na plátno | – | – |

**Rozdělení scény** (`scene-partition.ts`, s `three`, testuje se v Node):

```ts
/** Kořenové skupiny scény podle průchodu. Počítá se v každém snímku AO (pár objektů). */
export interface ScenePartition {
  readonly model: readonly THREE.Object3D[];        // [layers.main.group]
  readonly interaction: readonly THREE.Object3D[];  // ostatní přímí potomci scény
}
/** interaction = scene.children bez `model`, bez světel (`isLight`) a bez kamer (`isCamera`). */
export function partitionScene(scene: THREE.Scene, model: readonly THREE.Object3D[]): ScenePartition;

/** Všechny objekty `isLineSegments2` v podstromech `roots` (GTAOPass je v G-bufferu nekryje). */
export function aoExcluded(roots: readonly THREE.Object3D[]): THREE.Object3D[];

/**
 * Po dobu `fn` nastaví `visible = false` všem `objects`, pak vrátí **původní** hodnoty, i když `fn` vyhodí.
 * Objekt, který už skrytý byl, zůstane skrytý. Duplicity v `objects` nevadí.
 */
export function hideDuring<T>(objects: readonly THREE.Object3D[], fn: () => T): T;
```

- Rozdělení dělá viewport, ne vrstvy: nová vrstva přidaná do scény je automaticky interakce. Světla a kamera s headlightem se kreslí v obou průchodech.
- Mimo průchod je scéna nezměněná, takže `Raycaster` pickingu, obálka scény ani `visible` nastavené vrstvami (`setBodyVisible`, skrytá skupina) nic nepoznají.

**Nastavení a parametry** (`ao-parameters.ts`, **bez `three`**; uživatelské nastavení podle [[Q081 Uživatelské nastavení AO|Q081]]):

```ts
/** Uživatelské nastavení AO: předvolba stránky jako styl, ale samostatná (Q081). Zmrazené. */
export interface AoSettings {
  readonly radiusPx: number;         // poloměr v CSS px
  readonly intensity: number;        // síla násobení, 0..1
  readonly thicknessPx: number;      // tloušťka v CSS px (Pokročilé)
  readonly distanceFallOff: number;  // 0..1 (Pokročilé)
  readonly scale: number;            // (Pokročilé)
  readonly samples: number;          // celé číslo (Pokročilé)
}
export const DEFAULT_AO_SETTINGS: AoSettings;   // { radiusPx: 32, intensity: 1, thicknessPx: 16, distanceFallOff: 1, scale: 1, samples: 16 }

export interface AoSettingRange {
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly integer: boolean;   // jen celá čísla (validace, zarovnání v ui, formát hodnoty)
}
/** Rozsahy posuvníků i validace; jediné místo, kde jsou. Zmrazené. */
export const AO_SETTING_RANGES: Readonly<Record<keyof AoSettings, AoSettingRange>>;
//   radiusPx 4–128 / 1, intensity 0–1 / 0,05, thicknessPx 1–64 / 1,
//   distanceFallOff 0–1 / 0,05, scale 0–3 / 0,05, samples 4–32 / 1 (integer jen samples)

/** Platná hodnota pole: konečné číslo v rozsahu; při `integer` celé. */
export function isValidAoSetting(key: keyof AoSettings, value: number): boolean;

/** Parametry GTAO pro jeden snímek (světové jednotky, mm). */
export interface AoParameters {
  readonly radius: number;          // mm
  readonly thickness: number;       // mm
  readonly distanceFallOff: number;
  readonly scale: number;
  readonly samples: number;
  readonly intensity: number;
}
/** radius = radiusPx · worldPerPx, thickness = thicknessPx · worldPerPx, ostatní z nastavení beze změny. */
export function aoParameters(settings: AoSettings, worldPerPx: number): AoParameters;   // worldPerPx konečné > 0, jinak chyba
```

- AO se drží v pixelech jako čárky skrytých hran, takže vypadá stejně při každém zoomu a velikosti modelu.
- Výchozí hodnoty potvrdil Pavel při ručním ověření M23 (2026-10-15) beze změny. Testy hlídají úměrnost a rozsahy, ne konkrétní čísla.
- Konstanty `AO_RADIUS_PX` a `AO_THICKNESS_PX` z úkolu 2 zanikají, nahrazují je `DEFAULT_AO_SETTINGS`.
- Celočíselnost pole říká jen `AoSettingRange.integer`. Validace (`isValidAoSetting`), zarovnání v `ui` i formát hodnoty v panelu čtou tenhle příznak, nikdo nepíše `key === 'samples'` (revize M23).
- Seznam polí se všude odvozuje z `AO_SETTING_RANGES` (`Record` hlídá úplnost), ne z ručně psaného pole.
- `src/render/index.ts` exportuje `AoSettings`, `AoSettingRange`, `DEFAULT_AO_SETTINGS`, `AO_SETTING_RANGES` a `isValidAoSetting`. `app` je reexportuje pro `ui`. `AoParameters` a `aoParameters` zůstávají vnitřní.

**`Viewport.setAoSettings(settings: AoSettings)`** (od M23, mimo port jako `setDisplayStyle`):
- Neplatné pole (`isValidAoSetting`) je chyba, protože validaci dělá `ui` při čtení z úložiště.
- Stejné hodnoty (po polích) nic nedělají. Jinak se nastavení uloží a naplánuje se snímek (`scheduleFrame`), ale jen když plán má `ao`. Bez AO se nastavení projeví až po zapnutí.
- Funguje i před `mount`. Výchozí je `DEFAULT_AO_SETTINGS`.

**Pipeline** (`ao-pipeline.ts`, s `three`, ověřuje se e2e a ručně):

```ts
export interface AoPipeline extends Disposable {
  setSize(width: number, height: number): void;   // CSS px; target a G-buffer násobí poměrem pixelů rendereru
  render(partition: ScenePartition, params: AoParameters): void;   // průchody 1–4, výstup na plátno
}
export function createAoPipeline(deps: {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;   // OrthographicCamera rigu; GTAOPass si typ kamery čte při vytvoření
  width: number;          // CSS px
  height: number;
}): AoPipeline;
```

- `AoPass extends Pass` (`needsSwap = false`) vlastní `GTAOPass` s `output = GTAOPass.OUTPUT.Off` (spočítá jen `pdRenderTarget`) a `FullScreenQuad` s materiálem z `GTAOBlendShader`. Blending je násobení jako v `GTAOPass` (`CustomBlending`, `DstColorFactor`/`ZeroFactor`), bez `depthTest` a `depthWrite`. `render` zavolá `hideDuring([...interaction, ...aoExcluded(model)], () => gtao.render(…))` a pak quad do `readBuffer`.
- Průchody 1 a 3 jsou `RenderPass` obalené `hideDuring` (model skryje interakce, interakce skryjí model). Rozdělení dostanou při každém `render`.
- Druhý render target composeru se nikdy nepoužije, protože nikdo nestřídá buffery. Three ho na GPU alokuje až při prvním použití, takže nestojí paměť.
- `dispose`: `GTAOPass`, materiál a quad násobení, `OutputPass` a composer (render targety).

**Vlastnictví a životní cyklus** (viewport):

- Pipeline patří k připojenému rendereru: vzniká líně v `draw()` při prvním snímku s `plan.ao` a s rozměry z `canvas.clientWidth/Height`.
- Uvolní se, když `setDisplayStyle` přepne na plán s `ao: false`, a při `unmount` (patří do `mounted.resources`). Opětovné zapnutí ji vytvoří znovu.
- `resize` volá i `ao?.setSize(width, height)`.
- Poměr pixelů se čte z rendereru při vytvoření. Změnu `devicePixelRatio` za běhu neřeší ani dnešní plátno, takže zůstává mimo rozsah.
- `draw()` při AO: `ao.render(partitionScene(scene, [layers.main.group]), aoParameters(aoSettings, lastWorldPerPx))`.
- **Nulová velikost plátna** (skrytý prvek, `clientWidth` nebo `clientHeight` ≤ 0): snímek se nakreslí bez AO (`renderer.render`) a pipeline se nevytváří. Vznikla by jinak s targetem 0×0 a `worldPerPx` by nebylo konečné.

**Barvy:** render target composeru je lineární a `OutputPass` převede do sRGB stejně, jako renderer převádí při kreslení přímo na plátno. Pozadí (`setClearColor`) i barvy ploch tak vypadají stejně s AO i bez něj (e2e).
- **Nástraha `RenderPass`:** three převádí barvu mazání do barevného prostoru cíle jen v `setClearColor` a `render`. `RenderPass` ale maže po `setRenderTarget` a ještě před `render`, takže by lineární target smazal sRGB hodnotou z plátna a pozadí by s AO bylo světlejší. Průchod modelu (`TargetClearPass`, obal kolem `RenderPass`) proto po `setRenderTarget` nastaví barvu mazání znovu.

## Manipulátory

`ManipulatorLayer` (typ splňuje `ManipulatorPort`; vnitřní vrstva má `pick` s projekcí a port za ni doplní viewport, stejně jako u skic; [[10-interakce#Manipulátory (M18)]], [[0021-manipulatory-kotvy-z-regenerace|ADR 0021]], [[0022-rezimy-a-hud-manipulatoru|ADR 0022]]) kreslí úchyty [[Manipulátor|manipulátorů]] a pickuje je. Text s hodnotou kreslí `ui` (HUD), ne `render`.

### Rozměry a prahy

Rozměry glyfů a prahy skrytí **nevlastní `render`**. Jsou v datovém vstupním bodě `interaction/constants.ts` (`MANIPULATOR_GLYPHS`, `HANDLE_VISIBILITY`, [[M20-zpevneni-struktury|M20]] A6), protože o manipulátorech rozhoduje `interaction` a stejná čísla potřebuje HUD v `ui`. `render` smí z `interaction` jen typy, proto je dostane od `app` při vytvoření:

```ts
createViewport({ …, manipulatorGlyphs: ManipulatorGlyphs, handleVisibility: HandleVisibility })
```

V `render` zůstávají jen věci kreslení a pickingu: počty segmentů (`HANDLE_RING_SEGMENTS = 64`, `HANDLE_QUARTER_SEGMENTS = 16`) a tolerance pickingu (`HANDLE_*PICK_PX`).

### Glyfy

Velikosti jsou v CSS px. Glyf má na obrazovce konstantní velikost: měřítko skupiny = světové jednotky na pixel ortografické kamery (`(top − bottom) / zoom / výška plátna`), přepočítané ve `draw` před `renderer.render`.

| Druh | Glyf (hodnoty `MANIPULATOR_GLYPHS`) | Picking |
|---|---|---|
| `linear` | dřík `LineSegments2` 4 px od `arrowStartPx` (14) do `arrowShaftPx` (80) od `position` + kužel (`arrowConePx` 18, poloměr `arrowConeRadiusPx` 6) na konci; špička `arrowTipPx` = 98 | úsečka 14–98 px, tolerance 8 px |
| `angular` `quarter` | čtvrtkruh `LineSegments2` 4 px, poloměr `ringPx` (72), od `zero` k `axis × zero`, 16 segmentů | lomená čára, tolerance 6 px |
| `angular` `full` | kružnice 4 px, poloměr `ringPx`, 64 segmentů | lomená čára, tolerance 6 px |
| `planar` | čtverec od `squareNearPx` (26) do `squareFarPx` (46) po `u` i `v` od `origin`: výplň (průhlednost 0,35) + obrys 1,5 px | bod uvnitř promítnutého čtyřúhelníku |
| `point` | kotouček o poloměru `pointPx` (9) kolem `position` (stále natočený ke kameře), výplň barvou pozadí palety, obrys 2 px | vzdálenost od průmětu ≤ 10 px |

- **Skrytí** (hodnoty `HANDLE_VISIBILITY`): šipka s `|direction · směr pohledu| > arrowHideCos` (0,98), čtvrtkruh i kružnice s `|axis · směr pohledu| < ringHideCos` (0,05) a čtverec s `|(u × v) · směr pohledu| < squareHideCos` (0,05) se nekreslí a `pick` je nevrátí. Bod se neskrývá. **Invariant:** každý práh skrytí je přísnější než odpovídající práh tahu v `interaction` (`PARALLEL_LIMIT`, `EDGE_ON_LIMIT`, [[10-interakce]]), takže glyf zmizí dřív, než ho nejde táhnout. Hlídá ho test v `interaction`.
- **`dashed`:** čárkovaný dřík šipky a obrys čtverce (`LineMaterial` s `dashed`, čárka 6 px, mezera 5 px). Oblouky ho ignorují. Bod s `dashed` (střed v režimu pivotu) má plný obrys 2 px bez výplně a tečku o poloměru 3 px.
- **Barvy:** `tint` `x`/`y`/`z` → `palette.axes[0..2]`, `neutral` → `palette.selection`, stav `hover` a `active` → `palette.hover`. Výplň čtverce má barvu podle `tint` čtverce (normála roviny: čtverec XY má barvu Z). `setPalette` přebarví.
- **Pořadí kreslení:** `depthTest: false`, takže úchyt je vidět i uvnitř tělesa, které posouvá. Výplně (čtverec, bod) mají `renderOrder` 4, čáry, kužel a tečka 4,5 (nad skicami, které mají 3).
- `set(handles)` nahradí vše. Glyf se stejným `id` a `kind` se znovu použije (jen pozice, orientace, barva), ostatní se uvolní. Stejné pohledy jako minule nic nepřekreslují, jinak `requestRender()`. `dispose` uvolní geometrie a materiály.

### Promítnutí a picking

Tvar glyfu (délka, poloměr, skrytí) se počítá na jednom místě pro kreslení i picking, čistými funkcemi v `manipulator-pick.ts` (bez `three`):

```ts
type ScreenPoint = readonly [x: number, y: number];
type ScreenHandle =
  | { kind: 'linear'; id: string; from: ScreenPoint; to: ScreenPoint }                     // 14–98 px
  | { kind: 'angular'; id: string; points: readonly ScreenPoint[]; closed: boolean }       // closed = celá kružnice
  | { kind: 'planar'; id: string; corners: readonly ScreenPoint[] }
  | { kind: 'point'; id: string; center: ScreenPoint; radius: number };
interface HandleShape { readonly glyphs: ManipulatorGlyphs; readonly visibility: HandleVisibility }
function projectHandles(handles: readonly HandleView[], project: (p: Vec3) => ScreenPoint, worldPerPx: number, viewDirection: Vec3, shape: HandleShape): readonly ScreenHandle[];
// skryté úchyty vynechá (handleHidden), pořadí zachová
function pickHandle(screenHandles: readonly ScreenHandle[], x: number, y: number): string | null;
function handleBounds(handles: readonly HandleView[], worldPerPx: number, glyphs: ManipulatorGlyphs): Bounds | null;
```

- **Priorita pickingu:** `point` vyhrává vždy, když je v toleranci. Pak `planar` (bod uvnitř). Pak nejbližší z `linear` a `angular`, při shodě dřívější v pořadí `set`. Žádný úchyt nebo nepřipojený viewport → `null`.
- **Near a far:** obálka zobrazených úchytů (`handleBounds`) patří do obálky všeho viditelného ([[#Near a far]]), aby glyf daleko od těles neořízl hloubkový řez. Šipka a kružnice: krychle o poloviční straně délky šipky nebo poloměru × `worldPerPx`; čtverec: jeho čtyři rohy; bod: krychle o poloviční straně `pointPx` × `worldPerPx`. Počítá se i ze skrytých úchytů, aby obálka při otáčení neskákala.
- **`project(world)`** promítne bod kamerou do CSS px vůči ploše pohledu (stejně jako picking), nepřipojený viewport → `null`.
- **`viewChanged`:** ve `draw` po vykreslení, když se od minulého snímku změnila kamera (`target`, `orientation`, `halfHeight`) nebo velikost plochy; `generation` roste o 1. Změnu pozná čistá funkce `viewChangedSince(previous, next)` v `view-change.ts`. Animace kamery ho posílá každý snímek, klidová scéna nikdy. První snímek po `mount` se hlásí jako změna, aby si HUD spočítal polohy.


## Skici

Kresby skic a rovin ([[12-skicar#Kresba a picking]], [[0017-modul-sketch-a-skicar|ADR 0017]]) přicházejí jako `SketchDrawing` přes `SketchPort` ([[10-interakce#Port viewportu]]); `render` je tesseluje a pickuje sám. Data skici ani jádro nezná.

- **Čisté funkce** (bez `three`, test v Node): `tessellateSketch(drawing, maxStep = π/36)` v `sketch-drawing.ts` → světové `segments` (dvojice bodů xyz), `segmentCurves` (id křivky na segment), `segmentStyles`, `points` (xyz), `pointIds`, `pointStyles`; oblouk dostane `max(2, ⌈(endAngle − startAngle) / maxStep⌉)` segmentů, body přes `plane.toWorld`. `sketchHits(screenSegments, screenPoints, x, y, tolerancePx = 6)` v `sketch-pick.ts` → **všechny** zásahy v toleranci: body podle vzdálenosti, pak segmenty podle vzdálenosti (přes `closestSegments`), při shodě pořadí vstupu (M19.2). `pickSketch(…)` je jejich první prvek, nebo `null`. `betterSketchHit(hit, than)` rozhoduje mezi kresbami: bod před křivkou, pak menší vzdálenost.
- **`SketchLayer`** (`sketch-layer.ts`): pod každým id jedna skupina s `LineSegments2` (`LineMaterial` s barvami po vrcholech, šířka 2 px) a `Points` (7 px, bez zmenšování se vzdáleností); barva podle stylu z palety: `normal` → `sketch`, `defined` → `sketchDefined`, `construction` a `plane` → `construction`, `hover` → `hover`, `selected` → `selection`. `renderOrder` 3.
  - **Tělesa skicu zakrývají** (M19.2 D2, nahrazuje [[Rozhodnutí noční rychloakce#M12 – Skicář|R47]]): `LineMaterial` čar má `depthTest: true`, `depthWrite: false` a `polygonOffset` −1/−1 (k pozorovateli, jako hrany zvýraznění). Plochy těles mají posun +1/+1, takže čára ležící na ploše tělesa o hloubku nebojuje. `PointsMaterial` má `depthTest: true`, `depthWrite: false`, na body polygon offset nepůsobí a stačí posun ploch. Platí pro všechny kresby, tedy i pro roviny a osy počátku.
  - **Zakryté části editované skici:** kresba s `SketchDrawing.editing` (jen kresba skicáře, [[10-interakce#Skicář]]) má druhý průchod nad toutéž geometrií: čáry `LineSegments2` s `depthFunc: GreaterDepth`, `opacity` 0,35, `dashed` (čárka 6 px, mezera 4 px) a stejným polygon offsetem jako první průchod (jinak by se slabá čára kreslila i přes viditelnou část), body `Points` s `GreaterDepth` a `opacity` 0,35. `renderOrder` 3. Geometrie čar má `computeLineDistances()`.
  - `SketchLayerInternal.setPixelSize(worldPerPx: number, target: Vec3, viewportDiagonalPx: number)`: viewport ho volá ve `draw` před každým snímkem s `worldPerPx` ortografické kamery a úhlopříčkou plátna v CSS px. Nastaví `dashSize` a `gapSize` druhého průchodu v jednotkách modelu (stálá délka čárek v px) a přepočítá mřížku skici.
  - `set` nahradí vše pod id a uvolní starou geometrii, `remove` neznámého id nic. `setPalette` přebarví (i druhý průchod a mřížku), rozlišení `LineMaterial` dostává jako zvýraznění. `dispose` uvolní i materiály druhého průchodu a mřížky.
- **Mřížka skici** (M19.2 D4, čisté funkce v `sketch-grid.ts`):
  - `sketchGridStep(worldPerPx: number): number` vrátí nejmenší krok z řady 1–2–5 × 10ⁿ mm (n celé, i záporné), pro který jsou čáry aspoň 10 px od sebe. Neplatný vstup (≤ 0, NaN, nekonečno) → 1;
  - `gridLines(step, center: Vec2, halfExtent): { minor: number[]; major: number[] }` dá úsečky `u0, v0, u1, v1` v souřadnicích roviny pro čtverec `center ± halfExtent` na násobcích kroku. Čára na násobku 5 · krok je `major`. Víc než 400 čar na osu krok zdvojí. Neplatný krok nebo velikost → žádné čáry;
  - `SketchLayer` kreslí mřížku jen v rovině kresby s `editing`, bez ní žádnou. `LineSegments` 1 px, vedlejší čáry `palette.grid[1]`, hlavní `palette.grid[0]`, `depthTest: true`, `depthWrite: false`, `renderOrder` 1,5 (nad tělesy, pod výplněmi oblastí a čarami skici). Čtverec má `halfExtent` = `worldPerPx` · úhlopříčka / 2 okolo průmětu cíle kamery do roviny;
  - mřížka se staví znovu jen při změně roviny nebo kroku, posunu středu o víc než čtvrtinu `halfExtent` nebo když potřebný `halfExtent` vzroste (oddálení). Jinak zůstává;
  - mřížka patří do `SketchLayer.bounds()` ([[#Near a far]]). Je vidět bez ohledu na přepínač přichycení ve skicáři;
  - `Viewport.sketchGridStep()` = `sketchGridStep` z velikosti pixelu posledního snímku (před prvním snímkem 1). Podle něj skicář přichytí body ([[12-skicar#Režim skicáře (sketcher)]]).
- **Picking:** s `'sketchEntity'` ve filtru se nejdřív zkouší skici. `SketchLayerInternal.pick(camera, x, y, width, height, visible: (point: Vec3) => boolean)`: v každé kresbě se vezme první zásah ze `sketchHits`, jehož 3D bod je `visible`; kresba s `editing` kontrolu vynechá (editovaná skica zakrytá není). Mezi kresbami rozhoduje `betterSketchHit`. Viewport předá `visible` = `picker.isVisible(camera, point)` (M19.2 D2). Zásah → `{ kind: 'sketchEntity', sketch: id kresby, entity: id bodu nebo křivky, point }` (`point` = bod na segmentu nebo bod ve 3D). Bez zásahu pokračují hrany a plochy podle filtru. `camera.fitAll` kresby skic nezahrnuje.
- `HighlightLayer` cíle `sketchEntity` vypouští (zvýraznění skici nese styl kresby).
- **Oblasti** (M13, [[Rozhodnutí noční rychloakce#M13 – Extrude a Revolve|R75]]): kresba může nést `regions` (uzavřené polygony v rovině kresby, spočítá je `interaction`). `SketchLayer` z každé oblasti postaví výplň (`ShapeGeometry` z `THREE.Shape` s dírami v souřadnicích roviny, umístěnou rámcem roviny), bez zvýraznění neviditelnou; cíle `sketchRegion` z `HighlightLayer` ji obarví (`hover`, `selection`, průhlednost 0,35, `renderOrder` 2 – pod čarami skici). Výplň má od M19.2 `depthTest: true`, `depthWrite: false` a polygon offset −1/−1 jako čáry (D2, nahrazuje část R75), takže zvýrazněná oblast nepřebarví celé těleso, jen viditelnou část výplně. Picking oblasti je čistá funkce `pickSketchRegion(drawings, ray, accept?: (sketch, point) => boolean)` v `sketch-pick.ts`: průsečík paprsku s rovinou kresby (`plane.intersectRay`), `toLocal`, bod v polygonu (`pointInRegion`, sudo-liché pravidlo přes `outer` i `holes`), z více kreseb nejbližší podél paprsku. Oblast, kterou `accept` odmítne, se přeskočí a hledá se dál (bez `accept` platí každý zásah). Vrstva ji volá z `pickRegion(ray, visible)` s `accept` = kresba s `editing` vždy, jinak `visible(point)`, takže oblast za tělesem se nevybere. Zásah → `{ kind: 'sketchRegion', sketch: id kresby, region: id oblasti, point }`.
- **Pořadí v `pick`** podle filtru: `sketchEntity` > `sketchRegion` > hrany > plochy.

## Picking

`PickResult` definuje [[10-interakce#Port viewportu]] ([[Q057 Tvar PickResult|Q057]]).

Filtr (`PickFilter`, [[10-interakce#Port viewportu]], M10.1): průchod přes hrany (bod 2) běží jen s `'edge'` ve filtru, raycast ploch (bod 1) jen s `'face'`; prázdný filtr vrátí `null` bez dotazu na scénu. Výchozí je obojí. Plochy zakrývají hrany i s filtrem `['edge']`: raycast viditelnosti hrany (bod 2) s plochami počítá vždy, filtr vypíná jen výběr ploch jako výsledek.

1. Plochy: `THREE.Raycaster` jen proti meshům těles → první zásah → index trojúhelníku → `triangleToFace` → `faceIndex`. `normal` = normála trojúhelníku z jeho vinutí (proti směru hodinových ručiček při pohledu zvenku = ven, kontrakt [[06-geometricke-jadro|jádra]]) ve světových souřadnicích, **ven z tělesa**, neotáčí se podle paprsku. Orientace roviny skici na ploše (M12) tak nezávisí na tom, odkud se uživatel dívá.
2. Hrany: čistá funkce `closestSegments(screenSegments, x, y, tolerancePx)` nad segmenty promítnutými do pixelů vrátí kandidáty seřazené podle vzdálenosti (tolerance 6 px). Kandidát je viditelný, pokud raycast skrz jeho nejbližší bod nenarazí na plochu blíž než ten bod (tolerance 1e-4 × úhlopříčka scény). První viditelný kandidát vyhrává **před plochou**. `point` = nejbližší bod na segmentu ve 3D.
   - Viditelnost se testuje raycastem s `far` = hloubka bodu − tolerance (tolerance 1e-4 × úhlopříčka sjednocené obálky, nejméně 1e-6 mm). Plochy, které na hraně leží, ji tak nezakryjí.
   - Pravidlo vystavuje `Picker.isVisible(camera, point: Vec3): boolean` (M19.2): bod je vidět, když ho žádné zobrazené těleso nezakrývá. Bez zobrazených těles `true`. Používá ho picking skic a oblastí ([[#Skici]]).
   - Segment, jehož některý konec leží mimo `near`/`far`, se nepromítne (celý NaN) a nedá se vybrat. Segment jen zčásti mimo pohled zůstává. Od M17 `near`/`far` obalují všechno viditelné a nastavují se i před `pick` (viz [[#Near a far]]), takže viditelné hrany tím nikdy nevypadnou.
   - Hrana viděná z čela (průmět kratší než 1e-3 px, např. svislé hrany kvádru shora) bere bližší konec ke kameře, ne `t = 0`, aby ji nezakryl vlastní vzdálenější konec.
   - Výpočet bodu přes `t` z obrazovky platí jen pro ortografickou kameru. Projekce a raycasty běží při každém `pick`, pro velké modely bude potřeba cache nebo GPU picking (bod 4).
3. Ortografická kamera: paprsek z `screenToRay` má pro celé plátno stejný směr (směr pohledu), počátek leží na blízké rovině.
4. Pro velké modely později GPU picking (render ID do offscreen bufferu). Zatím ne.

## Testy

`render` se testuje nejhůř, proto v něm má být co nejméně logiky ([[Q061 Testy render v Node|Q061]]):
- Čisté funkce leží v souborech **bez importu `three`** (hlídá pravidlo v `.dependency-cruiser.cjs`, protože `three` v Node běží a testy by porušení nepoznaly) a testují se v Node (`tsconfig.test.json` beze změny): `diffBodies`, `triangleToFace`, `polylinesToSegments`, `faceTriangles`, `closestSegments`, `fitOrtho` a směry standardních pohledů, od M17 operace kamery (`orbit`, `pan`, `zoomAt`, `turn`, `ease`, `interpolate`, `clipRange`, `orientationFor`), `cameraGesture`, `wheelFactor`, `buildViewCube` a `cubeRegionAt`, `toViewPointerEvent`/`toViewKeyEvent`, `FrameScheduler`, `meshBounds`/`unionBounds` (obálka pro `fitAll`, počítaná z `positions`), `MeshCache`, sdílená cache `createSharedMeshCache` a generace `SceneSync`, od M12 `tessellateSketch`, `pickSketch` a `viewDirectionFor` (od M17 zaniká), od M13 `pickSketchRegion` a `pointInRegion`, od M15 `parseHexColor`, `pickHandle`, `projectHandles`, `handleBounds`, `handleHidden`, `arcPoints` a `viewChangedSince`, od M19.2 `sketchHits`, `sketchGridStep` a `gridLines` (`sketch-grid.ts`), od M22 `resolveDisplay` a `samePlan` (`display-style.ts`), od M23 `aoParameters`, `isValidAoSetting`, `AO_SETTING_RANGES` a `DEFAULT_AO_SETTINGS` (`ao-parameters.ts`) (proti ručnímu `MeshOps` v testu, jehož `tessellate` vrací odložené sliby, které test splní nebo odmítne v libovolném pořadí; bez Three.js – výsledkem je plán výměny, ne scéna).
- Testy `render` nesmí importovat `@/kernel/testing` (`FakeKernel`): `render` závisí na `kernel` jen typově a `testing.ts` otevírá jen hodnotovým závislostem ([[01-architektura]]). Sítě v testech jsou ruční, malé a záměrně s klíči ploch mimo pořadí.
- Kód s Three.js (`Viewport`, `BodyView`, vrstvy) se ověřuje ručně na dev stránce `dev/viewport.html` a e2e testy (Playwright). Three.js ale běží i v Node, takže část kódu s ním má testy v Node: `Picker` (`picker.test.ts` s ruční sítí; od [[M19.1-opravy-z-revize|M19.1]] i hrany z více segmentů, kontrola zakrytí a `body`, `edgeIndex` a `point` v aserci, od M19.2 `isVisible`), `SketchLayer` a `HighlightLayer`, od M23 `partitionScene`, `aoExcluded` a `hideDuring` (`scene-partition.ts`). Pipeline AO (`ao-pipeline.ts`) potřebuje WebGL, ověřuje ji e2e `m23.spec.ts` a ruční kontrola.

## Otevřené otázky

Otázky jsou samostatné poznámky v `60-otazky/` a odkazují sem. Novou otázku založ šablonou *Otázka*.

![[otazky.base#Otázky k této poznámce]]
