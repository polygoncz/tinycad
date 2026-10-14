---
type: adr
status: accepted
number: 19
aliases:
  - ADR 0019
  - Vlastní ovládání kamery
date: 2026-10-14
related:
  - "[[09-vykreslovani]]"
  - "[[M17-kamera-a-view-cube]]"
  - "[[Q016 Ortografická nebo perspektivní kamera]]"
  - "[[Q062 Závislost three a OrbitControls]]"
supersedes:
tags:
  - adr
created: 2026-10-14
updated: 2026-10-14
---
# 0019 – Vlastní ovládání kamery místo OrbitControls

- **Stav:** Přijato (`status: accepted`, Pavel 2026-10-14)
- **Datum:** 2026-10-14
- **Souvisí:** [[09-vykreslovani#Kamera]], [[M17-kamera-a-view-cube|M17]], [[Q016 Ortografická nebo perspektivní kamera|Q016]], [[Q062 Závislost three a OrbitControls|Q062]]

## Kontext

Od [[M08-vykreslovani|M8]] ovládá ortografickou kameru `OrbitControls` z `three/addons` ([[Q062 Závislost three a OrbitControls|Q062]]). Pro [[M17-kamera-a-view-cube|M17]] (view cube podle Onshape) to nestačí:

- `OrbitControls` umí jen **turntable** rotaci kolem pevné osy `camera.up`. Proto platí invariant „`camera.up` je vždy (0, 0, 1)“ a kvůli němu i hack s nakloněním pohledů `top`/`bottom` o 1e-4 rad. Šipky view cube pro **natočení kolem osy pohledu** (roll o 90°) nemají v tomto modelu řešení.
- View cube potřebuje **animované přechody** mezi orientacemi, otáčení tažením za cube a programové otočení o 90° kolem os obrazovky. `OrbitControls` drží vlastní stav (sférické souřadnice, `target`, `zoom`) a takové operace nenabízí ve veřejném API (`rotateLeft`/`rotateUp` jsou interní).
- Ořezávání modelu blízkou a vzdálenou rovinou se stejně musí řešit přepočtem `near`/`far` před každým snímkem, tedy mimo `OrbitControls`.

Pavel 2026-10-14 zvolil volnou rotaci (trackball) a roll šipky.

## Rozhodnutí

`OrbitControls` nahradíme vlastním ovládáním v modulu `render`:

- **Stav kamery** je `target`, `orientation` (quaternion: osy kamery x = vpravo, y = nahoru, z = směr od cíle ke kameře) a `halfHeight` (polovina viditelné výšky v mm). `camera.zoom` zůstává 1. Kamera už nemá invariant `up = Z`. „Z nahoru“ platí jen pro **standardní pohledy** a `setViewDirection` (pravidlo `viewBasis`).
- **Matematika** (orbit, posun, zoom ke kurzoru, roll, otočení o 90°, slerp s easingem, rozsah hloubky) jsou čisté funkce bez `three`, testované v Node.
- **Vstup** (pointer a kolečko na canvasu) překládá malý `CameraInput` na operace rigu. Mapování tlačítek zůstává jako dosud.
- **Animace** běží přes stávající `FrameScheduler`: rig s běžící animací si po každém snímku vyžádá další.

## Zvažované alternativy

- **Ponechat `OrbitControls`** a cube by jen volala `setViewDirection`. Nejméně práce, ale bez roll šipek, s bojem s interním stavem `OrbitControls` při animaci a tažení a s hackem náklonu top/bottom. Zamítnuto.
- **`TrackballControls` / `ArcballControls` z `three/addons`.** Umí volnou rotaci, ale mají vlastní, jinak laděné mapování tlačítek, setrvačnost a stav. Animace a otočení o 90° by stejně šly mimo ně a museli bychom synchronizovat dva zdroje pravdy o kameře. Zamítnuto.
- **Knihovna gizmo (např. `three-viewport-gizmo`).** Hotová cube, ale cizí vzhled a vstup, další závislost a výuková hodnota nulová. Zamítnuto.

## Důsledky

- (+) Jeden zdroj pravdy o kameře: `target`, `orientation`, `halfHeight`. Animace, cube, šipky i myš jsou jen operace nad ním.
- (+) Matematika kamery je testovatelná v Node. Dnes je chování `OrbitControls` netestované.
- (+) Zmizí hack náklonu top/bottom (`orbit-direction.ts`, `VIEW_TILT`), protože quaternion nemá degeneraci podél Z.
- (+) `near`/`far` se počítají před každým snímkem z obálky všeho viditelného, takže model se neořízne po posunu, zoomu ke kurzoru ani po změně geometrie.
- (−) Vlastní kód pro vstup: kolečko (`deltaMode`), pointer capture, modifikátory. Dotykové ovládání, které `OrbitControls` dávaly zadarmo, zatím nebude. Spec ho neřešila a aplikace je pro myš.
- (−) Volná rotace dovolí „převrátit“ model (Z dolů). To je záměr, cube a standardní pohledy vrátí orientaci jedním klikem.
