// Handles of manipulators (spec 09, "Manipulátory (M18)"): arrows and rings of a constant size on
// the screen, drawn over everything, plus the value label next to the cursor. A mirror like the
// highlight: interaction passes the whole state. The glyphs are built in CSS px around their
// origin; the viewport scales each one by the world units per px of the camera before every
// render. The shape on the screen comes from manipulator-pick.ts, so drawing and picking agree.

import * as THREE from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { assert, assertNever, vec3, type Disposable, type Vec3 } from '@/core';
import type { HandleView, ManipulatorLabel, ManipulatorPort } from '@/interaction';
import type { BoundingBox } from '@/kernel';
import {
  HANDLE_ARROW_PX,
  HANDLE_RING_PX,
  HANDLE_RING_SEGMENTS,
  handleBounds,
  handleHidden,
  pickHandle,
  projectHandles,
  type ScreenPoint,
} from './manipulator-pick';
import type { ScenePalette } from './palette';

/** Width of shafts and rings in CSS px. */
const LINE_WIDTH_PX = 3;
/** Cone at the tip of an arrow, in CSS px; the shaft takes the rest of HANDLE_ARROW_PX. */
const CONE_LENGTH_PX = 16;
const CONE_RADIUS_PX = 5;
const CONE_SEGMENTS = 16;
/** After the bodies (0), the highlight (1), the overlay (2) and the sketches (3). */
const RENDER_ORDER = 4;
/** Class of the label element; ui may style it further. */
const LABEL_CLASS = 'tc-manipulator-label';
/** Local axis the glyphs are built along: the arrow points along it, the ring lies across it. */
const LOCAL_AXIS = new THREE.Vector3(0, 0, 1);

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
   * arrow seen end-on and a ring seen edge-on hide. Requests nothing, the caller is drawing.
   */
  beforeRender(worldPerPx: number, viewDirection: Vec3): void;
  /**
   * Box around every glyph of the last set for the camera size worldPerPx (spec 09, "Near a
   * far"); null = no handles.
   */
  bounds(worldPerPx: number): BoundingBox | null;
  /** Recolours the shared materials in place (Q072); the caller requests the render. */
  setPalette(palette: ScenePalette): void;
  /** Canvas size in CSS px; fat-line materials need it to size their width in pixels. */
  setResolution(width: number, height: number): void;
  /** Creates the label element as the last child of the canvas's parent; shows the last label. */
  mountLabel(canvas: HTMLCanvasElement): void;
  /** Removes the label element; the label itself is kept for the next mountLabel. Idempotent. */
  unmountLabel(): void;
}

export interface ManipulatorLayerOptions {
  readonly requestRender: () => void;
  readonly palette: ScenePalette;
}

/** Colour of a glyph: its tint, or the hover colour when hovered or dragged. */
const COLOR_KEYS = ['x', 'y', 'z', 'neutral', 'hover'] as const;
type ColorKey = (typeof COLOR_KEYS)[number];

/** Materials shared by every glyph of one colour. */
interface Look {
  readonly line: LineMaterial;
  readonly cone: THREE.MeshBasicMaterial;
}

/** One drawn handle; reused by the next set while its id and kind stay. */
interface Glyph {
  readonly kind: HandleView['kind'];
  readonly root: THREE.Group;
  readonly line: LineSegments2;
  /** Only arrows have one. */
  readonly cone: THREE.Mesh | null;
  view: HandleView;
}

export function createManipulatorLayer(options: ManipulatorLayerOptions): ManipulatorLayerInternal {
  const { requestRender } = options;
  const group = new THREE.Group();
  const looks: Record<ColorKey, Look> = {
    x: createLook(options.palette.axes[0]),
    y: createLook(options.palette.axes[1]),
    z: createLook(options.palette.axes[2]),
    neutral: createLook(options.palette.selection),
    hover: createLook(options.palette.hover),
  };
  // Every glyph shares these; they are in CSS px and the glyph root scales them.
  const shaftGeometry = new LineSegmentsGeometry().setPositions([
    0,
    0,
    0,
    0,
    0,
    HANDLE_ARROW_PX - CONE_LENGTH_PX,
  ]);
  const coneGeometry = new THREE.ConeGeometry(CONE_RADIUS_PX, CONE_LENGTH_PX, CONE_SEGMENTS)
    // The cone points along +Y; turn it to +Z and put its tip at HANDLE_ARROW_PX.
    .rotateX(Math.PI / 2)
    .translate(0, 0, HANDLE_ARROW_PX - CONE_LENGTH_PX / 2);
  const ringGeometry = new LineSegmentsGeometry().setPositions(ringPositions());

  let views: readonly HandleView[] = [];
  let glyphs = new Map<string, Glyph>();
  let worldPerPx = 1;
  let viewDirection: Vec3 = [0, 0, -1];
  let label: ManipulatorLabel | null = null;
  let labelElement: HTMLDivElement | null = null;

  function createGlyph(view: HandleView): Glyph {
    const root = new THREE.Group();
    const line = new LineSegments2(
      view.kind === 'linear' ? shaftGeometry : ringGeometry,
      looks[colorKey(view)].line,
    );
    line.renderOrder = RENDER_ORDER;
    root.add(line);
    let cone: THREE.Mesh | null = null;
    if (view.kind === 'linear') {
      cone = new THREE.Mesh(coneGeometry, looks[colorKey(view)].cone);
      cone.renderOrder = RENDER_ORDER;
      root.add(cone);
    }
    group.add(root);
    return { kind: view.kind, root, line, cone, view };
  }

  /** Position, orientation, colour, size and visibility of the glyph from its view. */
  function place(glyph: Glyph, view: HandleView): void {
    glyph.view = view;
    const look = looks[colorKey(view)];
    glyph.line.material = look.line;
    if (glyph.cone !== null) glyph.cone.material = look.cone;
    const origin = view.kind === 'linear' ? view.position : view.center;
    const along = view.kind === 'linear' ? view.direction : view.axis;
    glyph.root.position.set(...origin);
    glyph.root.quaternion.setFromUnitVectors(
      LOCAL_AXIS,
      new THREE.Vector3(...vec3.normalize(along)),
    );
    fit(glyph);
  }

  /** Size of the camera and the hiding of an arrow seen end-on or a ring seen edge-on. */
  function fit(glyph: Glyph): void {
    glyph.root.scale.setScalar(worldPerPx);
    glyph.root.visible = !handleHidden(glyph.view, viewDirection);
  }

  function dropGlyph(glyph: Glyph): void {
    // The geometries and materials are shared; only the objects go.
    group.remove(glyph.root);
  }

  function showLabel(): void {
    if (labelElement === null) return;
    if (label === null) {
      labelElement.style.display = 'none';
      labelElement.textContent = '';
      return;
    }
    labelElement.textContent = label.text;
    labelElement.style.left = `${String(label.x)}px`;
    labelElement.style.top = `${String(label.y)}px`;
    labelElement.style.display = 'block';
  }

  return {
    group,
    set(next: readonly HandleView[]): void {
      if (sameViews(views, next)) return;
      // Before any change: duplicate ids would share one glyph.
      const ids = new Set(next.map((view) => view.id));
      assert(ids.size === next.length, 'Handle ids must be unique');
      const kept = new Map<string, Glyph>();
      for (const view of next) {
        const old = glyphs.get(view.id);
        const glyph = old?.kind === view.kind ? old : createGlyph(view);
        place(glyph, view);
        kept.set(view.id, glyph);
      }
      for (const [id, glyph] of glyphs) {
        if (kept.get(id) !== glyph) dropGlyph(glyph);
      }
      glyphs = kept;
      views = next;
      requestRender();
    },
    pick(x: number, y: number, projection: HandleProjection): string | null {
      if (views.length === 0) return null;
      const screen = projectHandles(
        views,
        projection.project,
        projection.worldPerPx,
        projection.viewDirection,
      );
      return pickHandle(screen, x, y);
    },
    setLabel(next: ManipulatorLabel | null): void {
      label = next;
      // A DOM element, not the canvas: no render needed.
      showLabel();
    },
    beforeRender(nextWorldPerPx: number, nextViewDirection: Vec3): void {
      worldPerPx = nextWorldPerPx;
      viewDirection = nextViewDirection;
      for (const glyph of glyphs.values()) fit(glyph);
    },
    bounds(cameraWorldPerPx: number): BoundingBox | null {
      return handleBounds(views, cameraWorldPerPx);
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
        looks[key].line.color.setHex(colors[key]);
        looks[key].cone.color.setHex(colors[key]);
      }
    },
    setResolution(width: number, height: number): void {
      for (const look of Object.values(looks)) look.line.resolution.set(width, height);
    },
    mountLabel(canvas: HTMLCanvasElement): void {
      const parent = canvas.parentElement;
      assert(parent !== null, 'The canvas needs a parent for the label');
      assert(labelElement === null, 'The label is already mounted');
      labelElement = createLabelElement();
      // Last, so it stacks above the canvas and the view cube.
      parent.appendChild(labelElement);
      showLabel();
    },
    unmountLabel(): void {
      labelElement?.remove();
      labelElement = null;
    },
    dispose(): void {
      for (const glyph of glyphs.values()) dropGlyph(glyph);
      glyphs = new Map();
      views = [];
      shaftGeometry.dispose();
      coneGeometry.dispose();
      ringGeometry.dispose();
      for (const look of Object.values(looks)) {
        look.line.dispose();
        look.cone.dispose();
      }
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
  // Seen through the bodies they move (depthTest off). Transparent at full opacity only to land
  // in the transparent queue, which three draws after the opaque one: so the handles stay above
  // the transparent region fills and face highlights as well, sorted by renderOrder.
  const flags = { color, depthTest: false, depthWrite: false, transparent: true } as const;
  return {
    line: new LineMaterial({ ...flags, linewidth: LINE_WIDTH_PX }),
    cone: new THREE.MeshBasicMaterial(flags),
  };
}

/** Segments of a ring of HANDLE_RING_PX around the origin in the local XY plane. */
function ringPositions(): number[] {
  const positions: number[] = [];
  const at = (i: number): [number, number, number] => {
    const angle = (2 * Math.PI * i) / HANDLE_RING_SEGMENTS;
    return [HANDLE_RING_PX * Math.cos(angle), HANDLE_RING_PX * Math.sin(angle), 0];
  };
  for (let i = 0; i < HANDLE_RING_SEGMENTS; i++) positions.push(...at(i), ...at(i + 1));
  return positions;
}

/** Field by field: the controller sends fresh objects, a new array is not a new state. */
function sameViews(a: readonly HandleView[], b: readonly HandleView[]): boolean {
  return a.length === b.length && a.every((view, i) => sameView(view, b[i]));
}

function sameView(a: HandleView, b: HandleView | undefined): boolean {
  if (b === undefined || a.id !== b.id || a.tint !== b.tint || a.state !== b.state) return false;
  if (a.kind === 'linear') {
    return (
      b.kind === 'linear' && sameVec(a.position, b.position) && sameVec(a.direction, b.direction)
    );
  }
  return b.kind === 'angular' && sameVec(a.center, b.center) && sameVec(a.axis, b.axis);
}

function sameVec(a: Vec3, b: Vec3): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

/** The label over the canvas; colours from the ui theme by name (render does not import ui). */
function createLabelElement(): HTMLDivElement {
  const element = document.createElement('div');
  element.className = LABEL_CLASS;
  Object.assign(element.style, {
    position: 'absolute',
    display: 'none',
    pointerEvents: 'none',
    background: 'var(--chrome-bg)',
    color: 'var(--text-primary)',
    padding: '2px 6px',
    borderRadius: '4px',
    fontSize: '12px',
    lineHeight: '1.4',
    whiteSpace: 'nowrap',
    fontVariantNumeric: 'tabular-nums',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.25)',
    userSelect: 'none',
  });
  return element;
}
