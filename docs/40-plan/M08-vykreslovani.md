---
type: milestone
status: done
order: 8
aliases:
  - M8
  - M8 Vykreslování
modules:
  - render
specs:
  - "[[09-vykreslovani]]"
depends_on:
  - "[[M07-kernel-occt]]"
started: 2026-10-13
finished: 2026-10-13
tags:
  - milnik
created: 2026-10-12
updated: 2026-10-13
---
# M8 – Vykreslování

**Cíl:** Three.js viewport, který zobrazí tělesa z regenerace, ovládá se jako Onshape (ortografická kamera) a umí říct, co je pod kurzorem.

**Specifikace:** [[09-vykreslovani|09 – vykreslování]]

**Navazuje na:** [[M07-kernel-occt]]

## Úkoly

- [x] Typy portu v `interaction`: `ViewportPort`, `HighlightPort`, `OverlayPort`, `PickResult`, `ViewPointerEvent`, `ViewKeyEvent`, re-export `BodyId`, `FakeViewport` ([[0009-platformove-nezavisla-domena|ADR 0009]]). `render` je importuje jen jako typy.
- [x] `Viewport implements ViewportPort`: mount/unmount, canvas, `ResizeObserver`, renderování na požádání, Z nahoru, mřížka, osový kříž, světla.
- [x] Ovládání kamery (pravé tlačítko otáčí, prostřední posouvá, kolečko zoom ke kurzoru), `CameraController.fitAll()`, standardní pohledy (izometrie, shora, zepředu…).
- [x] `MeshData` → `BodyView` (plochy + hrany, `polygonOffset`), `dispose`.
- [x] Čisté funkce: diff těles pro `SceneSync`, trojúhelník → plocha (binární vyhledávání v `faceRanges`). Testy v Node.
- [x] `SceneSync` / `BodyLayer.sync` s `MeshCache`, výměnou scény najednou a zahozením zastaralých výsledků.
- [x] Picking ploch (raycast) a hran (vzdálenost v pixelech).
- [x] `HighlightLayer` (hover, výběr) a `OverlayLayer` (pro náhledy nástrojů).
- [x] Události pointeru a klávesnice → převod z DOM na `ViewPointerEvent`/`ViewKeyEvent` → `Viewport.events`.
- [x] Dočasná dev stránka: dokument se dvěma kvádry → regenerace (OCCT) → viewport; hover zvýrazní plochu.

## Implementační plán

Každý úkol dělá zvlášť subagent `implementer` (TDD: test nejdřív a ověřit, že padá; `npm run check`). Kontrakt je v [[09-vykreslovani|spec 09]] a [[10-interakce#Port viewportu|spec 10, port viewportu]]. Rozhodnutí: [[Q016 Ortografická nebo perspektivní kamera|Q016]], [[Q056 Odkud render bere BodyId|Q056]]–[[Q062 Závislost three a OrbitControls|Q062]]. Ven z `render` jde jen to, co je v `index.ts`: `createViewport`, `MESH_QUALITY` a typy `Viewport`, `BodyLayer`, `CameraController`, `StandardView`, `HighlightLayer`, `OverlayLayer`. Čisté funkce leží v souborech **bez importu `three`** a testují se v Node ([[Q061 Testy render v Node|Q061]]). Kód s Three.js se v Node netestuje: ověřuje ho hlavní sezení na dev stránce (implementátor nemá prohlížeč), implementátor hlásí, co přesně má hlavní sezení zkontrolovat.

### Ú1 Port viewportu v `interaction`
- **Soubory:** `src/interaction/viewport-port.ts`, `src/interaction/index.ts`, `src/interaction/testing.ts`, test `src/interaction/testing.test.ts`.
- **Kontrakt:** [[10-interakce#Port viewportu]] – `ViewportPort`, `PickResult`, `HighlightPort`, `OverlayPort`, `OverlayShape`, `OverlayStyle`, `ViewPointerEvent` (včetně `'leave'`), `ViewKeyEvent`, `KeyMods`. `index.ts` re-exportuje `export type { BodyId } from '@/document'`. `FakeViewport implements ViewportPort` v `testing.ts`: nastavitelný výsledek `pick` (funkce nebo hodnota), `screenToRay` podle zadané funkce, zaznamenaný poslední stav `highlight` (hover, výběr) a `overlay` (mapa id → tvary), `emitPointer`/`emitKey`.
- **Testy:** `FakeViewport` – `pick` vrací nastavené, `setHover`/`setSelection` přepisují stav, `overlay.set` nahrazuje, `remove` neznámého id nic, `clear`, odběratel `events` dostane emitované události.
- **Hotovo když:** testy a `npm run check` projdou, `tsconfig.domain.json` typy portu přeloží bez DOM.

### Ú2 Závislost `three` a čisté funkce nad sítí
- **Soubory:** `package.json`, `.dependency-cruiser.cjs` (jen pokud `three/addons/...` neprojde pravidlem pro `render`), `src/render/mesh-index.ts`, `src/render/body-diff.ts` + testy.
- **Kontrakt:** [[09-vykreslovani#Závislost]]: `three` `~0.186`, `@types/three` `~0.186` (dev). [[09-vykreslovani#Reprezentace tělesa]]: `polylinesToSegments(edgePositions, edgeRanges)`, `triangleToFace(faceRanges, triangle)`, `faceTriangles(mesh, faceIndex)` a obdobně `edgeSegments(mesh, edgeIndex)` pro zvýraznění hrany. [[09-vykreslovani#Synchronizace s regenerací]] bod 1: `diffBodies(shown: ReadonlyMap<BodyId, ShapeHandle>, next)` → `{ add, remove, keep }`.
- **Testy:** polyline se 2 a s N body, víc hran za sebou, prázdné hrany; `triangleToFace` na první a poslední trojúhelník každé plochy, mimo rozsah → `undefined`; `faceTriangles` ruční sítě v testu (klíče ploch mimo pořadí; `FakeKernel` testy `render` importovat nesmí); diff: vše nové, vše stejné, změněný handle (v `remove` i `add`), zmizelé těleso, duplicitní `BodyId` → chyba. Ověřit dočasným importem `three/addons/controls/OrbitControls.js` v `render`, že `lint:deps` projde, a import zase odstranit.
- **Hotovo když:** testy a `npm run check` projdou.

### Ú3 Čisté pomůcky viewportu
- **Soubory:** `src/render/frame-scheduler.ts`, `src/render/view-events.ts`, `src/render/camera-math.ts`, `src/render/edge-pick.ts` + testy.
- **Kontrakt:** [[09-vykreslovani#Vykreslování na požádání]] (`createFrameScheduler({ requestFrame, cancelFrame, draw })` → `{ request(), dispose() }`); [[09-vykreslovani#Události]] (`toViewPointerEvent`, `toViewKeyEvent` nad prostými hodnotami); [[09-vykreslovani#Kamera]] (`STANDARD_VIEWS`: směr a `up` pro každý `StandardView`, `fitOrtho(bounds | null, viewDir, aspect, margin)`); [[09-vykreslovani#Picking]] bod 2 (`closestSegments(screenSegments: Float32Array /* x0,y0,x1,y1 */, x, y, tolerancePx)` → seřazení kandidáti `{ segment, t, distancePx }`). Vektory přes `vec3` z `@/core`.
- **Testy:** scheduler – tři `request` = jeden snímek, `request` během `draw` naplánuje další, `dispose` zruší; události – mapování tlačítek, `mod` na Macu a jinde, `move`/`leave` mají `button: null`; kamera – směry jsou jednotkové, `viewBasis` dává pravotočivou ortonormální bázi a „nahoru“ podle `STANDARD_VIEWS`, `fitOrtho` vejde krychli do výřezu pro poměr stran 1 i 2, `null` → výchozí výřez 200 × 200; hrany – bod na segmentu, za koncem, mimo toleranci, pořadí kandidátů, degenerovaný segment.
- **Hotovo když:** testy a `npm run check` projdou.

### Ú4 `SceneSync` a `MeshCache` bez Three.js
- **Soubory:** `src/render/mesh-cache.ts`, `src/render/scene-sync.ts` + testy.
- **Kontrakt:** [[09-vykreslovani#Synchronizace s regenerací]] body 1–7. `SceneSync` nezná Three.js: dostane `MeshOps`, kvalitu, `reportError` a `apply(plan: { remove: readonly BodyId[]; add: readonly { id: BodyId; shape: ShapeHandle; mesh: MeshData }[] })`, kterou zavolá synchronně jednou za úspěšnou generaci. Vystavuje `sync` a `reset` (tvar `BodyLayer`). Stav „zobrazeno“ (`BodyId → ShapeHandle`) aktualizuje až v `apply`; těleso s chybou tessellace se do něj nezapíše.
- **Testy** (proti ručnímu `MeshOps` v testu s ručně řízenými sliby, ne `FakeKernel`): první sync přidá vše; druhý se stejnými handle → `apply` s prázdným plánem nebo bez volání (zvolit a zdokumentovat); změněný handle; dva souběžné sync → `apply` jen pro novější; `reset` během sync → starý výsledek zahozen; stejný handle ve dvou souběžných sync → `tessellate` jednou; chyba v aktuální generaci → `reportError`, ostatní tělesa v plánu; chyba v zastaralé → nic; cache po výměně zapomene nepoužité handle; `sync` se nikdy neodmítne.
- **Hotovo když:** testy a `npm run check` projdou.

### Ú5 `Viewport`, scéna a kamera
- **Soubory:** `src/render/viewport.ts`, `src/render/camera-controller.ts`, `src/render/scene-helpers.ts`, `src/render/index.ts`, `dev/viewport.html`, `dev/viewport.ts`, případně `vite.config.ts` (vstup dev stránky jako u `dev/occt.html`).
- **Kontrakt:** [[09-vykreslovani#Viewport]], [[09-vykreslovani#Vykreslování na požádání]], [[09-vykreslovani#Kamera]], [[09-vykreslovani#Scéna]], [[09-vykreslovani#Události]]. `createViewport` zatím s `bodies`, `highlight`, `overlay` jako prázdnými implementacemi, `pick` vrací `null`. Dev stránka: celoobrazovkový viewport, tlačítka standardních pohledů a „Fit“, počítadlo vykreslených snímků (pro kritérium nečinnosti) a výpis posledních `events`.
- **Testy:** jen čisté části z Ú3; zde `npm run check`.
- **Hotovo když:** `npm run check` projde a hlavní sezení na dev stránce ověří: mřížka v XY, osový kříž, ovládání pravým/prostředním/kolečkem, standardní pohledy, při nečinnosti se počítadlo snímků nemění, `events` chodí včetně `leave`, změna velikosti okna nedeformuje.

### Ú6 `BodyView` a `BodyLayer` s regenerací na dev stránce
- **Soubory:** `src/render/body-view.ts`, `src/render/body-layer.ts`, `src/render/viewport.ts`, `dev/viewport.ts`.
- **Kontrakt:** [[09-vykreslovani#Reprezentace tělesa]] a vlastnictví GPU zdrojů v [[09-vykreslovani#Synchronizace s regenerací]]. `BodyLayer` = `SceneSync` z Ú4 + `apply`, které vytváří a uvolňuje `BodyView`. Dev stránka: OCCT jádro (`createOcctKernel`), dokument se dvěma kvádry přes operace, `createRegenerator` s `boxPlugin`, výsledek regenerace → `viewport.bodies.sync(...)` → po prvním `fitAll()`. Pole pro výšku jednoho kvádru (změna parametru → operace → regenerace → sync). Skládání podle integračních testů regenerace.
- **Testy:** čisté části už v Ú2 a Ú4; zde `npm run check`.
- **Hotovo když:** `npm run check` projde a hlavní sezení ověří: dva kvádry s hranami bez z-fightingu, změna výšky neproblikne, v Memory/Performance panelu nerostou geometrie při opakované změně (počet živých WebGL bufferů vypsaný na dev stránce).

### Ú7 Picking
- **Soubory:** `src/render/picker.ts`, `src/render/viewport.ts`, `dev/viewport.ts`.
- **Kontrakt:** [[09-vykreslovani#Picking]] a `screenToRay` z [[09-vykreslovani#Viewport]]. Dev stránka vypisuje výsledek `pick` pod kurzorem.
- **Hotovo když:** `npm run check` projde a hlavní sezení ověří: plochy kvádru vrací 6 různých `faceIndex` a normály ven, hrana vyhraje do ~6 px, zadní (zakrytá) hrana se nevybere, prázdné místo → `null`.

### Ú8 `HighlightLayer` a `OverlayLayer`
- **Soubory:** `src/render/highlight-layer.ts`, `src/render/overlay-layer.ts`, `src/render/viewport.ts`, `dev/viewport.ts`.
- **Kontrakt:** [[09-vykreslovani#Vrstvy pro interakci]] a bod 9 v [[09-vykreslovani#Synchronizace s regenerací]]. Dev stránka: `move` → `pick` → `highlight.setHover`, `leave` → `setHover(null)`, levé kliknutí → `setSelection`, ukázkový overlay (např. osy nebo úsečka) za přepínačem. Logika je jen na dev stránce, do `interaction` patří až v [[M09-interakce|M9]].
- **Hotovo když:** `npm run check` projde a hlavní sezení ověří: hover zvýrazní správnou plochu i hranu, odjezd z plátna hover zruší, výběr přežije změnu parametru (pokud index existuje), overlay se zobrazí a zmizí, při nečinnosti se nevykresluje.

### Ú9 Ověření akceptačních kritérií (hlavní sezení)
Projít kritéria na dev stránce (prohlížeč v aplikaci, Performance panel), zapsat výsledek do retrospektivy, spustit `architecture-reviewer`.

## Akceptační kritéria

- Dev stránka zobrazí kvádry s hranami, kamera funguje, hover zvýrazňuje správnou plochu.
- Při nečinnosti se nevykresluje (ověřit v Performance panelu).
- Změna parametru v dev stránce nevyvolá problikávání.
- `render` neimportuje `document`, `ops`, `regen`.

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Co se naučíš

Three.js (BufferGeometry, materiály, raycasting, správa GPU zdrojů), render-on-demand.

## Retrospektiva

> _Návrh od Clauda – doplň nebo uprav._

**Co bylo jinak, než se čekalo**
- **Rozhodování před implementací bylo větší než implementace.** Spec 09 a 10 se rozcházely (`PickResult`, chybějící `HighlightPort`/`OverlayPort`, odkud vzít `BodyId`), takže vzniklo sedm otázek ([[Q056 Odkud render bere BodyId|Q056]]–[[Q062 Závislost three a OrbitControls|Q062]]) a tři návrhová rozhodnutí (vlastnictví GPU zdrojů, kopie zvýraznění, jeden plánovač snímků). Až potom šlo sepsat plán.
- **Ortografická kamera** ([[Q016 Ortografická nebo perspektivní kamera|Q016]]) zjednodušila picking hran (jedno měřítko v celé scéně), ale přinesla degenerovaný pohled shora: `OrbitControls` potřebuje stálé `up` = +Z, takže `top`/`bottom` stojí na náklonu 1e-4 rad.
- **Pravidlo hranic modulů zasáhlo testy:** `render` závisí na `kernel` jen typově, takže testy nesměly použít `FakeKernel`. Ruční `MeshOps` s odloženými sliby se nakonec ukázal jako lepší nástroj na souběhy generací.
- **Tři ze čtyř skutečných chyb se ukázaly až v prohlížeči:** 1px čáry zvýraznění (WebGL `linewidth` ignoruje → `LineSegments2`), hook na `WebGLRenderer.prototype.render`, který se nikdy nezavolal (metody jsou na instanci), a snímek opožděný o jeden kvůli vykreslování na požádání.
- **Revize našla rozpor ve smluvené normále** (ke kameře, nebo ven z tělesa). Rozhodnuto ven podle vinutí a sken ve všech šesti pohledech zároveň potvrdil kontrakt vinutí adaptéru OCCT.

**Co se osvědčilo**
- **`SceneSync` bez Three.js:** generace, cache a chyby tessellace testované v Node s ručně řízenými sliby, `BodyLayer` jen „hloupě“ provádí plán. Tenká vrstva Three.js pak fungovala napoprvé.
- **Měřitelná kritéria na dev stránce:** počítadlo snímků (obalený `requestAnimationFrame`) a počet živých WebGL bufferů (obalené `createBuffer`/`deleteBuffer`) proměnily „nevykresluje se“ a „neuniká“ v čísla, aniž by se pokřivilo API viewportu.
- **Sken celé obrazovky přes `viewport.pick`** jako test pickingu: 0 zásahů do zakrytých hran, 6 ploch s normálami ven.
- Implementátoři opět hlásili díry ve spec jako otázky; z hlášení vzniklo přes deset upřesnění spec 09.

**Co příště jinak**
- Kód s Three.js ověřovat v prohlížeči po každém úkolu, ne až na konci: implementátor nemá prohlížeč, takže jeho „hotovo“ u vizuálních úkolů znamená jen „přeloží se“.
- Pravidla typu „čistý soubor bez `three`“ hned vynutit strojově (přidáno až po revizi do `.dependency-cruiser.cjs`).
