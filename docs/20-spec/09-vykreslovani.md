---
type: spec
status: draft
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

Zobrazuje výsledek regenerace pomocí Three.js a odpovídá na otázku „co je pod kurzorem“. O dokumentu ani featurách neví nic – pracuje s tělesy (`BodyId`), handle a sítěmi. Závisí na `core`, typech z `kernel`, typech z `interaction` (port `ViewportPort` a události, [[0009-platformove-nezavisla-domena|ADR 0009]]) a knihovně `three`.

## Viewport

```ts
export class Viewport implements ViewportPort, Disposable {
  constructor(opts: { background?: number });

  mount(el: HTMLElement): void;        // vytvoří canvas, ResizeObserver, ovládání kamery
  unmount(): void;

  requestRender(): void;               // vykreslení na požádání, ne smyčka 60 fps
  pick(x: number, y: number): PickResult | null;   // souřadnice v pixelech vůči canvasu
  screenToRay(x: number, y: number): { origin: Vec3; direction: Vec3 };

  readonly bodies: BodyLayer;          // tělesa z regenerace
  readonly highlight: HighlightLayer;  // hover a výběr (implementuje HighlightPort)
  readonly overlay: OverlayLayer;      // dočasná geometrie nástrojů (implementuje OverlayPort)
  readonly camera: CameraController;   // fit all, standardní pohledy

  readonly events: Emitter<{ pointer: ViewPointerEvent; key: ViewKeyEvent }>;
}
```

- **Vykreslování na požádání:** změna scény nebo kamery zavolá `requestRender()`, který naplánuje jeden snímek přes `requestAnimationFrame`. Statická scéna nežere CPU ani baterii.
- Pointer události se z canvasu převádějí na `ViewPointerEvent` (typ definuje `interaction`, pozice v px, tlačítka, modifikátory) a předávají se `interaction` přes `events`. Viewport sám nic nevybírá.
- `mount`, `bodies` a `camera` nejsou součástí portu: používá je jen `app` (kompoziční kořen). Nástroje vidí jen `ViewportPort`.
- Ovládání kamery jako v Onshape: pravé tlačítko otáčí, prostřední posouvá, kolečko zoomuje ke kurzoru. Začneme s `OrbitControls` z Three.js s přemapovanými tlačítky, později případně vlastní ovládání nebo knihovna `camera-controls`.
- Z nahoru: `camera.up.set(0, 0, 1)`, mřížka v rovině XY, osový kříž v rohu.

## Synchronizace s regenerací

```ts
export interface BodyLayer {
  /** Aktualizuje zobrazená tělesa. Vrací se, až jsou nové sítě připravené. */
  sync(bodies: readonly { id: BodyId; shape: ShapeHandle }[]): Promise<void>;
}
```

Implementace `SceneSync`:
1. Porovná nové `(BodyId, ShapeHandle)` se zobrazenými.
2. Stejné `BodyId` i handle → nic. Nový handle → `kernel.tessellate(handle)` (přes `MeshCache` klíčovanou handle).
3. Jakmile jsou **všechny** nové sítě hotové, vymění scénu najednou (žádné problikávání napůl starého a napůl nového modelu).
4. Zmizelá tělesa → `dispose()` geometrie a materiálů.
5. Pokud mezitím přišel novější `sync`, výsledek starého se zahodí (stejný vzor generací jako v regeneraci).

`BodyLayer` dostane `MeshOps` jádra v konstruktoru – `render` tedy závisí jen na rozhraní `MeshOps`, ne na celém jádru.

## Reprezentace tělesa

`BodyView` (jedna instance na těleso):
- `THREE.Mesh` s `BufferGeometry` ze `MeshData` – plochy,
- `THREE.LineSegments` – hrany (z `edgePositions`), tmavé, mírně posunuté proti z-fightingu (`polygonOffset` na plochách),
- pomocná pole pro mapování trojúhelník → plocha (`faceRanges`) a segment → hrana.

Zvýraznění plochy nevyžaduje novou geometrii: `HighlightLayer` vytvoří malou sub-geometrii ze stejných bufferů (rozsah trojúhelníků dané plochy) s jiným materiálem.

## Picking

```ts
export type PickResult =
  | { kind: 'face'; body: BodyId; faceIndex: number; point: Vec3; normal: Vec3 }
  | { kind: 'edge'; body: BodyId; edgeIndex: number; point: Vec3 }
  | { kind: 'vertex'; body: BodyId; vertexIndex: number; point: Vec3 };
```

1. Raycast na plochy (`THREE.Raycaster`) → index trojúhelníku → binární vyhledání v `faceRanges` → `faceIndex`.
2. Hrany: test vzdálenosti paprsku od segmentů v pixelech (tolerance ~6 px) – hrany mají při překryvu přednost před plochou.
3. Pro velké modely později GPU picking (render ID do offscreen bufferu). Zatím ne.

## Testy

`render` se testuje nejhůř, proto v něm má být co nejméně logiky:
- Mapování trojúhelník → plocha a segment → hrana jako čisté funkce, testované v Node.
- `SceneSync` diff (co přidat/odebrat/ponechat) jako čistá funkce.
- Zbytek ověřit ručně a smoke testem v prohlížeči (Playwright, později).

## Otevřené otázky

Otázky jsou samostatné poznámky v `60-otazky/` a odkazují sem. Novou otázku založ šablonou *Otázka*.

![[otazky.base#Otázky k této poznámce]]
