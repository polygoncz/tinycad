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
tags:
  - spec
created: 2026-10-12
updated: 2026-10-13
---
# 09 – `render`: vykreslování

> **Pojmy:** [[Viewport]], [[Handle tvaru]], [[Těleso]]  
> **Milník:** [[M08-vykreslovani]]

Zobrazuje výsledek regenerace pomocí Three.js a odpovídá na otázku „co je pod kurzorem“. O dokumentu ani featurách neví nic – pracuje s tělesy (`BodyId`), handle a sítěmi. Závisí na `core`, typech z `kernel`, typech z `interaction` (port `ViewportPort`, události a `BodyId`, [[0009-platformove-nezavisla-domena|ADR 0009]]) a knihovně `three`.

## Závislost

`three` ~0.186 a `@types/three` ~0.186 (dev). Z `kernel` bere `render` jen typy `MeshData`, `MeshOps`, `MeshQuality`, `ShapeHandle` a `BoundingBox`. Three.js má verze `0.x`, minor vydání může rozbít API, proto `~`. `OrbitControls` z `three/addons/controls/OrbitControls.js` (podcesta stejného balíku). Nové ADR není potřeba, Three.js zvolil [[0001-jadro-v-cistem-ts|ADR 0001]] ([[Q062 Závislost three a OrbitControls|Q062]]).

## Viewport

```ts
export interface Viewport extends ViewportPort, Disposable {
  mount(el: HTMLElement): void;        // vytvoří canvas, renderer, ResizeObserver, ovládání kamery; podruhé bez unmount = chyba
  unmount(): void;                     // uvolní renderer a canvas, scéna (tělesa, kamera) zůstává; idempotentní

  requestRender(): void;               // vykreslení na požádání, ne smyčka 60 fps
  pick(x: number, y: number): PickResult | null;   // px vůči canvasu (CSS px); nepřipojený viewport → null
  screenToRay(x: number, y: number): { origin: Vec3; direction: Vec3 };  // nepřipojený → chyba

  readonly bodies: BodyLayer;          // tělesa z regenerace
  readonly highlight: HighlightLayer;  // hover a výběr (implementuje HighlightPort)
  readonly overlay: OverlayLayer;      // dočasná geometrie nástrojů (implementuje OverlayPort)
  readonly camera: CameraController;   // fit all, standardní pohledy

  setPalette(palette: ScenePalette): void;   // přebarví existující materiály, nic nevytváří znovu (Q072)
  setBodyVisible(body: BodyId, visible: boolean): void; // stav pohledu z Prohlížeče (Q071)

  readonly events: Subscribable<{ pointer: ViewPointerEvent; key: ViewKeyEvent }>;
}

export function createViewport(deps: {
  meshes: MeshOps;
  quality?: MeshQuality;                              // výchozí MESH_QUALITY
  palette?: ScenePalette;                             // výchozí LIGHT_PALETTE (nahrazuje background)
  reportError?: (body: BodyId, error: unknown) => void;  // výchozí console.error
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
  readonly axes: readonly [x: number, y: number, z: number];   // obě palety 0xff3b30, 0x34c759, 0x0a84ff (mockup)
  readonly grid: readonly [center: number, line: number];
}
export const LIGHT_PALETTE: ScenePalette;
export const DARK_PALETTE: ScenePalette;
```

- Typy portu (`ViewportPort`, `PickResult`, `HighlightTarget`, `HighlightPort`, `OverlayPort`, události, `BodyId`) definuje [[10-interakce#Port viewportu]], `render` je importuje jen jako typy z `@/interaction`.
- `mount`, `bodies` a `camera` nejsou součástí portu: používá je jen `app` (kompoziční kořen). Nástroje vidí jen `ViewportPort`.
- `dispose()`: `unmount()`, uvolní všechna tělesa, zvýraznění, overlay, ovládání kamery a odběratele `events`. Další volání čehokoli kromě `dispose` je chyba, i na podobjektech (`bodies`, `camera`, `highlight`, `overlay`, `events.on`).
- Barvy scény jsou jen v `ScenePalette` ([[Q072 Barvy scény podle režimu|Q072]]): konstanty `FACE_COLOR`, `EDGE_COLOR`, barvy ve `highlight-layer`, `overlay-layer` a `scene-helpers` se nahradí čtením z palety. `setPalette` změní barvy materiálů a pozadí a zavolá `requestRender()`. Paletu vybírá `app` podle režimu, který mu předá `ui` (`AppSession.setTheme`); `ui` typy z `render` nezná.
- `setBodyVisible` jen skryje nebo ukáže `BodyView` (`visible`); picking skryté těleso ignoruje (ani nezakrývá tělesa za ním), zvýraznění skrytého tělesa se nekreslí a `camera.fitAll` ho vynechá (rozhodnutí 2026-10-13). Světla scény paleta nemá. Těleso, které po `sync` zmizí, ztratí i stav viditelnosti. Viditelnost se neukládá ([[Q071 Viditelnost těles|Q071]]).
- `mount` je odolný proti chybě (např. prohlížeč bez WebGL): uvolní, co už vytvořil, a výjimku pošle dál.
- Známé omezení: Three.js si na materiálech registruje posluchače `dispose` s odkazem na renderer, takže materiály žijící celý život viewportu mohou po opakovaném `mount`/`unmount` držet staré renderery v paměti CPU až do `dispose`. Opakovaný mount je vzácný, neřešíme.
- `unmount()` volá `renderer.forceContextLoss()`: prohlížeč dovolí jen několik kontextů WebGL a opakovaný `mount` by je vyčerpal. Po opětovném `mount` zůstane kamera, jak byla, výchozí pohled (`iso` + `fitAll`) se nastaví jen při prvním `mount`.

### Vykreslování na požádání

Jediný plánovač snímků (`FrameScheduler`, čistý modul s injektovaným `requestAnimationFrame`/`cancelAnimationFrame`): `request()` nastaví příznak a naplánuje **nejvýš jeden** snímek, další volání do vykreslení nic nedělají. `dispose()` zruší naplánovaný snímek. `requestRender()` volají vrstvy (`bodies`, `highlight`, `overlay`) po každé změně, kamera na událost `change` z `OrbitControls` a `ResizeObserver`. Mimo tyto podněty se nevykresluje vůbec, statická scéna nežere CPU ani baterii.

### Kamera

- **Ortografická** (`THREE.OrthographicCamera`, [[Q016 Ortografická nebo perspektivní kamera|Q016]]), Z nahoru: `camera.up = (0, 0, 1)`.
- Ovládání jako v Onshape přes `OrbitControls` s přemapovanými tlačítky: pravé otáčí, prostřední posouvá, kolečko zoomuje ke kurzoru (`zoomToCursor = true`, mění `camera.zoom`). Levé tlačítko kameru neovládá, patří výběru. Kontextové menu na canvasu je potlačené.
- Dotykové ovládání zatím zůstává výchozí z `OrbitControls` (jeden prst otáčí), spec ho neřeší. `OrbitControls` s klávesou Shift nebo Ctrl/Cmd prohazuje posun a otáčení (vestavěné chování).
- Při změně velikosti plátna se přepočítá `left/right/top/bottom` podle poměru stran, výška pohledu zůstane.

```ts
export type StandardView = 'iso' | 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right';

export interface CameraController {
  fitAll(): void;                    // obálka všech těles; prázdná scéna → výchozí výřez 200 × 200 mm kolem počátku
  setView(view: StandardView): void; // nastaví směr pohledu a pak fitAll()
}
```

Směry (odkud se kamera dívá, a co je na obrazovce nahoře): `front` z −Y (+Z), `back` z +Y, `right` z +X, `left` z −X, `top` z +Z (+Y), `bottom` z −Z (+Y), `iso` z (1, −1, 1) (+Z promítnuté do roviny pohledu).

- `camera.up` je **vždy** (0, 0, 1). `OrbitControls` si osu `up` čte jen při vytvoření a s jinou neumí otáčet. Orientaci obrazovky proto neurčuje `camera.up`, ale pravidlo `viewBasis(direction)`: nahoře je +Z promítnuté do roviny pohledu, při pohledu podél Z je to +Y.
- Pohled přesně podél Z je pro `OrbitControls` degenerovaný (polární úhel 0). `top` a `bottom` proto stojí na směru nakloněném o 1e-4 rad: `top` k −Y, `bottom` k +Y. Promítnuté +Z pak na obrazovce míří k +Y, jak `viewBasis` slibuje.
- Čistá funkce `fitOrtho(bounds, direction, aspect, margin = 0.1)` spočítá cíl (střed obálky), poloviční výšku výřezu (obálka promítnutá do báze `viewBasis` se vejde s okrajem 10 %) a vzdálenost kamery. Kamera stojí 2R od cíle (R = polovina úhlopříčky obálky), `near` = R/2, `far` = 3,5R. Uvnitř tak zůstane celá opsaná koule, tedy i při otáčení kolem cíle. Zoom mění jen `camera.zoom`, posun posouvá kameru i cíl, `near`/`far` platí dál.

### Scéna

- Mřížka v rovině XY (`GridHelper` otočený o 90° kolem X; `depthWrite = false`, `renderOrder = -1`, takže se kreslí první a tělesa ji vždy zakryjí. Bez toho by mřížka v z = 0 bojovala se spodními plochami těles o hloubku. Důsledek: mřížku tělesa zakryjí i tam, kde by měla být před nimi, třeba při pohledu zespodu), osový kříž v levém dolním rohu (druhá malá scéna s vlastní kamerou, která kopíruje natočení hlavní, vykreslená přes `setViewport`/`setScissor`).
- Světla: slabé `HemisphereLight` + `DirectionalLight` připnuté ke kameře („čelovka“), takže osvětlení sleduje pohled jako v CAD.

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
9. Po výměně scény `HighlightLayer` přestaví zvýraznění z nových sítí. Cíle, jejichž těleso zmizelo nebo index je mimo rozsah, tiše vypustí. Jestli index po regeneraci ukazuje na „stejnou“ plochu, řeší až [[08-topologicke-pojmenovani|topologické pojmenování]] (M14).

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
  - Hrana: **tlusté čáry** `LineSegments2` + `LineMaterial` z `three/addons` (3 px). WebGL kreslí `LineSegments` vždy 1 px široké bez ohledu na `linewidth`, takže by zvýraznění na hraně tělesa zaniklo. `LineMaterial` potřebuje rozlišení plátna, viewport ho předává při každé změně velikosti.
  - Přestavbu po výměně scény spouští `BodyLayer` volbou `afterApply` (volá se v `apply` po výměně, před `requestRender`).
- `OverlayLayer implements OverlayPort`: `OverlayShape` → `LineSegments`/`Points` ve vlastní skupině scény, styly `preview` a `construction` jako dva sdílené materiály. `set(id, …)` uvolní předchozí geometrii pod stejným `id`. `lines` s lichým počtem bodů je chyba (assert), pod `id` pak zůstane předchozí stav. `construction` je čárkovaná (`LineDashedMaterial`).
- Zvýraznění a overlay do pickingu nevstupují. Zvýraznění plochy se kreslí nad plochou tělesa díky `polygonOffset` (u čar a bodů nemá účinek). Hrany zvýraznění a overlay mají `depthTest` zapnutý a vyšší `renderOrder` (zvýraznění 1, overlay 2): na stejné hloubce vyhrají, ale tělesa před nimi je zakryjí.

## Picking

`PickResult` definuje [[10-interakce#Port viewportu]] ([[Q057 Tvar PickResult|Q057]]).

1. Plochy: `THREE.Raycaster` jen proti meshům těles → první zásah → index trojúhelníku → `triangleToFace` → `faceIndex`. `normal` = normála trojúhelníku z jeho vinutí (proti směru hodinových ručiček při pohledu zvenku = ven, kontrakt [[06-geometricke-jadro|jádra]]) ve světových souřadnicích, **ven z tělesa**, neotáčí se podle paprsku. Orientace roviny skici na ploše (M12) tak nezávisí na tom, odkud se uživatel dívá.
2. Hrany: čistá funkce `closestSegments(screenSegments, x, y, tolerancePx)` nad segmenty promítnutými do pixelů vrátí kandidáty seřazené podle vzdálenosti (tolerance 6 px). Kandidát je viditelný, pokud raycast skrz jeho nejbližší bod nenarazí na plochu blíž než ten bod (tolerance 1e-4 × úhlopříčka scény). První viditelný kandidát vyhrává **před plochou**. `point` = nejbližší bod na segmentu ve 3D.
   - Viditelnost se testuje raycastem s `far` = hloubka bodu − tolerance (tolerance 1e-4 × úhlopříčka sjednocené obálky, nejméně 1e-6 mm). Plochy, které na hraně leží, ji tak nezakryjí.
   - Segment, jehož některý konec leží mimo `near`/`far`, se nepromítne (celý NaN) a nedá se vybrat. Segment jen zčásti mimo pohled zůstává.
   - Hrana viděná z čela (průmět kratší než 1e-3 px, např. svislé hrany kvádru shora) bere bližší konec ke kameře, ne `t = 0`, aby ji nezakryl vlastní vzdálenější konec.
   - Výpočet bodu přes `t` z obrazovky platí jen pro ortografickou kameru. Projekce a raycasty běží při každém `pick`, pro velké modely bude potřeba cache nebo GPU picking (bod 4).
3. Ortografická kamera: paprsek z `screenToRay` má pro celé plátno stejný směr (směr pohledu), počátek leží na blízké rovině.
4. Pro velké modely později GPU picking (render ID do offscreen bufferu). Zatím ne.

## Testy

`render` se testuje nejhůř, proto v něm má být co nejméně logiky ([[Q061 Testy render v Node|Q061]]):
- Čisté funkce leží v souborech **bez importu `three`** (hlídá pravidlo v `.dependency-cruiser.cjs`, protože `three` v Node běží a testy by porušení nepoznaly) a testují se v Node (`tsconfig.test.json` beze změny): `diffBodies`, `triangleToFace`, `polylinesToSegments`, `faceTriangles`, `closestSegments`, `fitOrtho` a směry standardních pohledů, `toViewPointerEvent`/`toViewKeyEvent`, `FrameScheduler`, `meshBounds`/`unionBounds` (obálka pro `fitAll`, počítaná z `positions`), `MeshCache` a generace `SceneSync` (proti ručnímu `MeshOps` v testu, jehož `tessellate` vrací odložené sliby, které test splní nebo odmítne v libovolném pořadí; bez Three.js – výsledkem je plán výměny, ne scéna).
- Testy `render` nesmí importovat `@/kernel/testing` (`FakeKernel`): `render` závisí na `kernel` jen typově a `testing.ts` otevírá jen hodnotovým závislostem ([[01-architektura]]). Sítě v testech jsou ruční, malé a záměrně s klíči ploch mimo pořadí.
- Kód s Three.js (`Viewport`, `BodyView`, vrstvy, picking) se ověřuje ručně na dev stránce `dev/viewport.html`. Smoke test v prohlížeči (Playwright) později.

## Otevřené otázky

Otázky jsou samostatné poznámky v `60-otazky/` a odkazují sem. Novou otázku založ šablonou *Otázka*.

![[otazky.base#Otázky k této poznámce]]
