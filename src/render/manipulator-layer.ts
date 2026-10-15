// Handles of manipulators (spec 09, "Manipulátory (M18)" and "Vzhled od M19 (styl Fusion)"):
// arrows, quarters and rings, squares and centre points of a constant size on the screen, drawn
// over everything. A mirror like the highlight: interaction passes the whole state. The glyphs are
// built in CSS px around their origin; the viewport scales each one by the world units per px of
// the camera before every render. The shape on the screen comes from manipulator-pick.ts, so
// drawing and picking agree.

import * as THREE from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { assert, assertNever, vec3, type Disposable, type Quat, type Vec3 } from '@/core';
import type { HandleView, ManipulatorPort } from '@/interaction';
import type { BoundingBox } from '@/kernel';
import {
  arcPoints,
  HANDLE_QUARTER_SEGMENTS,
  HANDLE_RING_SEGMENTS,
  handleBounds,
  handleHidden,
  pickHandle,
  projectHandles,
  type HandleShape,
  type ScreenPoint,
} from './manipulator-pick';
import type { ScenePalette } from './palette';

/** Width of shafts, quarters and rings in CSS px. */
const LINE_WIDTH_PX = 4;
/** Width of the outline of a square in CSS px. */
const SQUARE_OUTLINE_PX = 1.5;
/** Width of the outline of a point in CSS px. */
const POINT_OUTLINE_PX = 2;
/** Opacity of the fill of a square. */
const SQUARE_FILL_OPACITY = 0.35;
/** Dashes of a dashed glyph (the pivot mode) in CSS px. */
const DASH_PX = 6;
const GAP_PX = 5;
/** Radius of the dot in the middle of a dashed point, in CSS px (spec 09 gives no size). */
const POINT_DOT_PX = 3;
const CONE_SEGMENTS = 16;
const CIRCLE_SEGMENTS = 32;
/**
 * After the bodies (0), the highlight (1), the overlay (2) and the sketches (3). Fills a bit
 * before lines, so the outline and the dot of a point stay above its fill.
 */
const FILL_RENDER_ORDER = 4;
const LINE_RENDER_ORDER = 4.5;
/** Local axis the glyphs are built along: the arrow points along it, the ring lies across it. */
const LOCAL_AXIS = new THREE.Vector3(0, 0, 1);

/**
 * Seen through the bodies they move (depthTest off). Transparent (lines and cones at full opacity)
 * to land in the transparent queue, which three draws after the opaque one: so the handles stay
 * above the transparent region fills and face highlights as well, sorted by renderOrder.
 */
const MATERIAL_FLAGS = {
  depthTest: false,
  depthWrite: false,
  transparent: true,
  side: THREE.DoubleSide,
} as const;

/** Handles of manipulators (spec 09, "Manipulátory (M18)"): implements ManipulatorPort. */
export type ManipulatorLayer = ManipulatorPort;

/** How the viewport maps the world onto its screen right now; see projectHandles. */
export interface HandleProjection {
  readonly project: (p: Vec3) => ScreenPoint;
  readonly worldPerPx: number;
  readonly viewDirection: Vec3;
}

/** What the viewport needs on top of ManipulatorPort; internal. */
export interface ManipulatorLayerInternal extends Omit<ManipulatorPort, 'pick'>, Disposable {
  /** Parent of every glyph; the viewport puts it into the scene. */
  readonly group: THREE.Group;
  /** Id of the handle under (x, y) in CSS px by the last set; null = none. */
  pick(x: number, y: number, projection: HandleProjection): string | null;
  /**
   * Before every render: the glyphs take the size of the camera (world units per CSS px), an
   * arrow seen end-on and a ring or square seen edge-on hide, a point turns to the camera
   * (`orientation` of the camera rig). Requests nothing, the caller is drawing.
   */
  beforeRender(worldPerPx: number, viewDirection: Vec3, orientation: Quat): void;
  /**
   * Box around every glyph of the last set for the camera size worldPerPx (spec 09, "Near a
   * far"); null = no handles.
   */
  bounds(worldPerPx: number): BoundingBox | null;
  /** Recolours the shared materials in place (Q072); the caller requests the render. */
  setPalette(palette: ScenePalette): void;
  /** Canvas size in CSS px; fat-line materials need it to size their width in pixels. */
  setResolution(width: number, height: number): void;
}

export interface ManipulatorLayerOptions {
  readonly requestRender: () => void;
  readonly palette: ScenePalette;
  /** Sizes of the glyphs and limits of their hiding (interaction, through app; M20). */
  readonly shape: HandleShape;
}

/** Colour of a glyph: its tint, or the hover colour when hovered or dragged. */
const COLOR_KEYS = ['x', 'y', 'z', 'neutral', 'hover'] as const;
type ColorKey = (typeof COLOR_KEYS)[number];

/** Materials shared by every glyph of one colour. */
interface Look {
  /** Shafts, quarters and rings. */
  readonly line: LineMaterial;
  readonly dashedLine: LineMaterial;
  readonly squareOutline: LineMaterial;
  readonly dashedSquareOutline: LineMaterial;
  readonly pointOutline: LineMaterial;
  /** Cones and the dot of a dashed point. */
  readonly solid: THREE.MeshBasicMaterial;
  readonly squareFill: THREE.MeshBasicMaterial;
}

/** One drawn handle; reused by the next set while its id and kind stay. */
type Glyph = { readonly root: THREE.Group; view: HandleView } & (
  | { readonly kind: 'linear'; readonly shaft: LineSegments2; readonly cone: THREE.Mesh }
  | { readonly kind: 'angular'; readonly arc: LineSegments2 }
  | { readonly kind: 'planar'; readonly fill: THREE.Mesh; readonly outline: LineSegments2 }
  | {
      readonly kind: 'point';
      readonly fill: THREE.Mesh;
      readonly outline: LineSegments2;
      readonly dot: THREE.Mesh;
    }
);

export function createManipulatorLayer(options: ManipulatorLayerOptions): ManipulatorLayerInternal {
  const { requestRender, shape } = options;
  const size = shape.glyphs;
  const group = new THREE.Group();
  const looks: Record<ColorKey, Look> = {
    x: createLook(options.palette.axes[0]),
    y: createLook(options.palette.axes[1]),
    z: createLook(options.palette.axes[2]),
    neutral: createLook(options.palette.selection),
    hover: createLook(options.palette.hover),
  };
  // The fill of a point has the colour of the background, whatever its tint.
  const pointFillMaterial = new THREE.MeshBasicMaterial({
    ...MATERIAL_FLAGS,
    color: options.palette.background,
  });
  // Every glyph shares these; they are in CSS px and the glyph root scales them.
  const shaftGeometry = new LineSegmentsGeometry().setPositions([
    0,
    0,
    size.arrowStartPx,
    0,
    0,
    size.arrowShaftPx,
  ]);
  const coneGeometry = new THREE.ConeGeometry(
    size.arrowConeRadiusPx,
    size.arrowConePx,
    CONE_SEGMENTS,
  )
    // The cone points along +Y; turn it to +Z and put its base at the end of the shaft.
    .rotateX(Math.PI / 2)
    .translate(0, 0, size.arrowShaftPx + size.arrowConePx / 2);
  const ringGeometry = new LineSegmentsGeometry().setPositions(
    segmentPositions(localArc(size.ringPx, 2 * Math.PI, HANDLE_RING_SEGMENTS), true),
  );
  const quarterGeometry = new LineSegmentsGeometry().setPositions(
    segmentPositions(localArc(size.ringPx, Math.PI / 2, HANDLE_QUARTER_SEGMENTS), false),
  );
  const near = size.squareNearPx;
  const far = size.squareFarPx;
  const squareCorners: readonly Vec3[] = [
    [near, near, 0],
    [far, near, 0],
    [far, far, 0],
    [near, far, 0],
  ];
  const squareFillGeometry = new THREE.BufferGeometry()
    .setAttribute('position', new THREE.Float32BufferAttribute(squareCorners.flat(), 3))
    .setIndex([0, 1, 2, 0, 2, 3]);
  const squareOutlineGeometry = new LineSegmentsGeometry().setPositions(
    segmentPositions(squareCorners, true),
  );
  const pointFillGeometry = new THREE.CircleGeometry(size.pointPx, CIRCLE_SEGMENTS);
  const pointOutlineGeometry = new LineSegmentsGeometry().setPositions(
    segmentPositions(localArc(size.pointPx, 2 * Math.PI, CIRCLE_SEGMENTS), true),
  );
  const pointDotGeometry = new THREE.CircleGeometry(POINT_DOT_PX, CIRCLE_SEGMENTS);

  /** Every view of the last set, in its order. */
  let views: readonly HandleView[] = [];
  let glyphs = new Map<string, Glyph>();
  let worldPerPx = 1;
  let viewDirection: Vec3 = [0, 0, -1];
  let orientation: Quat = [0, 0, 0, 1];

  function line(geometry: LineSegmentsGeometry, material: LineMaterial): LineSegments2 {
    const object = new LineSegments2(geometry, material);
    object.renderOrder = LINE_RENDER_ORDER;
    return object;
  }

  function mesh(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    renderOrder: number,
  ): THREE.Mesh {
    const object = new THREE.Mesh(geometry, material);
    object.renderOrder = renderOrder;
    return object;
  }

  /** The objects of a glyph; place gives them their materials, geometry and pose. */
  function createGlyph(view: HandleView): Glyph {
    const root = new THREE.Group();
    const look = looks[colorKey(view)];
    let glyph: Glyph;
    switch (view.kind) {
      case 'linear': {
        const shaft = line(shaftGeometry, look.line);
        // Dashes need the distances along the line; they land on the shared geometry, the same
        // every time.
        shaft.computeLineDistances();
        const cone = mesh(coneGeometry, look.solid, LINE_RENDER_ORDER);
        root.add(shaft, cone);
        glyph = { kind: 'linear', root, view, shaft, cone };
        break;
      }
      case 'angular': {
        const arc = line(ringGeometry, look.line);
        root.add(arc);
        glyph = { kind: 'angular', root, view, arc };
        break;
      }
      case 'planar': {
        const fill = mesh(squareFillGeometry, look.squareFill, FILL_RENDER_ORDER);
        const outline = line(squareOutlineGeometry, look.squareOutline);
        outline.computeLineDistances();
        root.add(fill, outline);
        glyph = { kind: 'planar', root, view, fill, outline };
        break;
      }
      case 'point': {
        const fill = mesh(pointFillGeometry, pointFillMaterial, FILL_RENDER_ORDER);
        const outline = line(pointOutlineGeometry, look.pointOutline);
        const dot = mesh(pointDotGeometry, look.solid, LINE_RENDER_ORDER);
        root.add(fill, outline, dot);
        glyph = { kind: 'point', root, view, fill, outline, dot };
        break;
      }
      default:
        return assertNever(view);
    }
    group.add(root);
    return glyph;
  }

  /** Materials, geometry, position, orientation, size and visibility of the glyph from its view. */
  function place(glyph: Glyph, view: HandleView): void {
    glyph.view = view;
    const look = looks[colorKey(view)];
    if (glyph.kind === 'linear' && view.kind === 'linear') {
      glyph.shaft.material = view.dashed ? look.dashedLine : look.line;
      glyph.cone.material = look.solid;
      glyph.root.position.set(...view.position);
      glyph.root.quaternion.setFromUnitVectors(
        LOCAL_AXIS,
        new THREE.Vector3(...vec3.normalize(view.direction)),
      );
    } else if (glyph.kind === 'angular' && view.kind === 'angular') {
      glyph.arc.geometry = view.extent === 'full' ? ringGeometry : quarterGeometry;
      glyph.arc.material = look.line;
      glyph.root.position.set(...view.center);
      // Local X → zero, local Y → axis × zero, local Z → axis: the quarter runs from zero.
      const axis = vec3.normalize(view.axis);
      orient(glyph.root, perpendicularUnit(view.zero, axis), axis);
    } else if (glyph.kind === 'planar' && view.kind === 'planar') {
      glyph.fill.material = look.squareFill;
      glyph.outline.material = view.dashed ? look.dashedSquareOutline : look.squareOutline;
      glyph.root.position.set(...view.origin);
      // Local X → u, local Y → v (unit and perpendicular, spec 10).
      orient(glyph.root, vec3.normalize(view.u), vec3.normalize(vec3.cross(view.u, view.v)));
    } else if (glyph.kind === 'point' && view.kind === 'point') {
      // Dashed (the pivot mode): the outline without the fill, and a dot in the middle.
      glyph.fill.visible = !view.dashed;
      glyph.dot.visible = view.dashed;
      glyph.outline.material = look.pointOutline;
      glyph.dot.material = look.solid;
      glyph.root.position.set(...view.position);
    } else {
      // set creates a new glyph whenever the kind changes.
      assert(false, 'Glyph and view of different kinds');
    }
    fit(glyph);
  }

  /** Size of the camera, the hiding of glyphs seen end-on or edge-on, a point facing the camera. */
  function fit(glyph: Glyph): void {
    glyph.root.scale.setScalar(worldPerPx);
    glyph.root.visible = !handleHidden(glyph.view, viewDirection, shape.visibility);
    // The camera looks along its local −Z: with its orientation the disc lies in the screen.
    if (glyph.kind === 'point') glyph.root.quaternion.set(...orientation);
  }

  function dropGlyph(glyph: Glyph): void {
    // The geometries and materials are shared; only the objects go.
    group.remove(glyph.root);
  }

  return {
    group,
    set(all: readonly HandleView[]): void {
      // Before any change: duplicate ids would share one glyph.
      const ids = new Set(all.map((view) => view.id));
      assert(ids.size === all.length, 'Handle ids must be unique');
      if (sameViews(views, all)) return;
      const kept = new Map<string, Glyph>();
      for (const view of all) {
        const old = glyphs.get(view.id);
        const glyph = old?.kind === view.kind ? old : createGlyph(view);
        place(glyph, view);
        kept.set(view.id, glyph);
      }
      for (const [id, glyph] of glyphs) {
        if (kept.get(id) !== glyph) dropGlyph(glyph);
      }
      glyphs = kept;
      views = all;
      requestRender();
    },
    pick(x: number, y: number, projection: HandleProjection): string | null {
      if (views.length === 0) return null;
      const screen = projectHandles(
        views,
        projection.project,
        projection.worldPerPx,
        projection.viewDirection,
        shape,
      );
      return pickHandle(screen, x, y);
    },
    beforeRender(nextWorldPerPx: number, nextViewDirection: Vec3, nextOrientation: Quat): void {
      worldPerPx = nextWorldPerPx;
      viewDirection = nextViewDirection;
      orientation = nextOrientation;
      for (const glyph of glyphs.values()) fit(glyph);
    },
    bounds(cameraWorldPerPx: number): BoundingBox | null {
      return handleBounds(views, cameraWorldPerPx, size);
    },
    setPalette(next: ScenePalette): void {
      const colors: Record<ColorKey, number> = {
        x: next.axes[0],
        y: next.axes[1],
        z: next.axes[2],
        neutral: next.selection,
        hover: next.hover,
      };
      for (const key of COLOR_KEYS) {
        for (const material of lookMaterials(looks[key])) material.color.setHex(colors[key]);
      }
      pointFillMaterial.color.setHex(next.background);
    },
    setResolution(width: number, height: number): void {
      for (const look of Object.values(looks)) {
        for (const material of lookMaterials(look)) {
          if (material instanceof LineMaterial) material.resolution.set(width, height);
        }
      }
    },
    dispose(): void {
      for (const glyph of glyphs.values()) dropGlyph(glyph);
      glyphs = new Map();
      views = [];
      for (const geometry of [
        shaftGeometry,
        coneGeometry,
        ringGeometry,
        quarterGeometry,
        squareFillGeometry,
        squareOutlineGeometry,
        pointFillGeometry,
        pointOutlineGeometry,
        pointDotGeometry,
      ]) {
        geometry.dispose();
      }
      for (const look of Object.values(looks)) {
        for (const material of lookMaterials(look)) material.dispose();
      }
      pointFillMaterial.dispose();
    },
  };
}

function colorKey(view: HandleView): ColorKey {
  switch (view.state) {
    case 'idle':
      return view.tint;
    case 'hover':
    case 'active':
      return 'hover';
    default:
      return assertNever(view.state);
  }
}

function createLook(color: number): Look {
  const lineMaterial = (linewidth: number, dashed: boolean): LineMaterial =>
    new LineMaterial({
      color,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      linewidth,
      ...(dashed ? { dashed: true, dashSize: DASH_PX, gapSize: GAP_PX } : {}),
    });
  return {
    line: lineMaterial(LINE_WIDTH_PX, false),
    dashedLine: lineMaterial(LINE_WIDTH_PX, true),
    squareOutline: lineMaterial(SQUARE_OUTLINE_PX, false),
    dashedSquareOutline: lineMaterial(SQUARE_OUTLINE_PX, true),
    pointOutline: lineMaterial(POINT_OUTLINE_PX, false),
    solid: new THREE.MeshBasicMaterial({ ...MATERIAL_FLAGS, color }),
    squareFill: new THREE.MeshBasicMaterial({
      ...MATERIAL_FLAGS,
      color,
      opacity: SQUARE_FILL_OPACITY,
    }),
  };
}

function lookMaterials(look: Look): readonly (LineMaterial | THREE.MeshBasicMaterial)[] {
  return [
    look.line,
    look.dashedLine,
    look.squareOutline,
    look.dashedSquareOutline,
    look.pointOutline,
    look.solid,
    look.squareFill,
  ];
}

/** Turns `root` so its local X is `x` and its local Z is `z` (both unit and perpendicular). */
function orient(root: THREE.Object3D, x: Vec3, z: Vec3): void {
  const y = vec3.cross(z, x);
  const basis = new THREE.Matrix4().makeBasis(
    new THREE.Vector3(...x),
    new THREE.Vector3(...y),
    new THREE.Vector3(...z),
  );
  root.quaternion.setFromRotationMatrix(basis);
}

/** `v` without its part along the unit `axis`, made unit (as arcPoints does with zero). */
function perpendicularUnit(v: Vec3, axis: Vec3): Vec3 {
  return vec3.normalize(vec3.sub(v, vec3.scale(axis, vec3.dot(v, axis))));
}

/** Points of an arc of `radius` px in the local XY plane from +X towards +Y, `segments` + 1 of them. */
function localArc(radius: number, sweep: number, segments: number): readonly Vec3[] {
  return arcPoints([0, 0, 0], [0, 0, 1], [1, 0, 0], radius, sweep, segments, segments + 1);
}

/**
 * Pairs of points for LineSegmentsGeometry along the polyline; closed joins the last point to the
 * first (a full circle whose last point repeats the first needs no closing).
 */
function segmentPositions(points: readonly Vec3[], closed: boolean): number[] {
  const positions: number[] = [];
  const count = closed ? points.length : points.length - 1;
  for (let i = 0; i < count; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (a !== undefined && b !== undefined) positions.push(...a, ...b);
  }
  return positions;
}

/** Field by field: the controller sends fresh objects, a new array is not a new state. */
function sameViews(a: readonly HandleView[], b: readonly HandleView[]): boolean {
  return a.length === b.length && a.every((view, i) => sameView(view, b[i]));
}

function sameView(a: HandleView, b: HandleView | undefined): boolean {
  if (
    b === undefined ||
    a.id !== b.id ||
    a.tint !== b.tint ||
    a.state !== b.state ||
    a.dashed !== b.dashed
  ) {
    return false;
  }
  switch (a.kind) {
    case 'linear':
      return (
        b.kind === 'linear' && sameVec(a.position, b.position) && sameVec(a.direction, b.direction)
      );
    case 'angular':
      return (
        b.kind === 'angular' &&
        a.extent === b.extent &&
        sameVec(a.center, b.center) &&
        sameVec(a.axis, b.axis) &&
        sameVec(a.zero, b.zero)
      );
    case 'planar':
      return (
        b.kind === 'planar' && sameVec(a.origin, b.origin) && sameVec(a.u, b.u) && sameVec(a.v, b.v)
      );
    case 'point':
      return b.kind === 'point' && sameVec(a.position, b.position);
  }
}

function sameVec(a: Vec3, b: Vec3): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}
