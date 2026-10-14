// Drawings of sketches and planes (spec 09, "Skici"): SketchDrawing → fat lines and points in an
// own group, coloured per vertex by the style of the entity. Bodies hide them (M19.2, D2): depth
// is tested, pulled slightly towards the viewer so a line on a body face does not fight it. The
// edited sketch (SketchDrawing.editing) has a second, faint and dashed pass for its hidden parts
// and the sketch grid in its plane. A mirror like the overlay, but pickable: pick projects the
// tessellated drawings into px, asks sketchHits and skips hits hidden behind bodies. Regions of a
// drawing (M13) get a transparent fill each, invisible until the highlight layer hands their hover
// or selection over; pickRegion intersects the ray with the drawing planes.

import * as THREE from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import {
  assert,
  assertNever,
  plane as planeMath,
  type Disposable,
  type Plane,
  type Vec2,
  type Vec3,
} from '@/core';
import type {
  HighlightTarget,
  PickResult,
  SketchDrawing,
  SketchDrawingRegion,
  SketchPort,
  SketchStyle,
} from '@/interaction';
import type { BoundingBox } from '@/kernel';
import { meshBounds, unionBounds } from './bounds';
import type { ScenePalette } from './palette';
import { projectSegments, segmentPoint } from './pick-math';
import { tessellateSketch, type SketchTessellation } from './sketch-drawing';
import { gridLines, sketchGridStep } from './sketch-grid';
import { betterSketchHit, pickSketchRegion, sketchHits, type SketchHit } from './sketch-pick';

/** Width of sketch curves in CSS px. */
const LINE_WIDTH_PX = 2;
/** Size of sketch points in CSS px (no size attenuation, like a marker). */
const POINT_SIZE = 7;
/** After the bodies, the highlight and the overlay. */
const RENDER_ORDER = 3;
/** Region fills: under the sketch lines (spec 09, "Skici"). */
const FILL_RENDER_ORDER = 2;
const FILL_OPACITY = 0.35;
/** The sketch grid: over the bodies, under the region fills and the sketch lines (M19.2). */
const GRID_RENDER_ORDER = 1.5;
/** Opacity of the hidden parts of the edited sketch (M19.2, D2). */
const HIDDEN_OPACITY = 0.35;
/** Dashes of the hidden parts of the edited sketch, in CSS px. */
const DASH_PX = 6;
const GAP_PX = 4;
/** Pulls lines and fills towards the viewer; body faces are pushed back by +1/+1 (body-view). */
const PULL_FORWARD = { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 };

/** A highlight target of a sketch region (M13). */
export type RegionTarget = Extract<HighlightTarget, { readonly kind: 'sketchRegion' }>;

/** Drawings of sketches and planes (spec 09, "Skici"): implements SketchPort. */
export type SketchLayer = SketchPort;

/** What the viewport needs on top of SketchPort; internal. */
export interface SketchLayerInternal extends SketchPort, Disposable {
  /** Parent of every drawing; the viewport puts it into the scene. */
  readonly group: THREE.Group;
  /**
   * The sketch entity under (x, y) in CSS px of a canvas of width × height CSS px, across all
   * drawings: points before curves. In each drawing the first hit whose 3D point is `visible`
   * (not hidden behind a body) counts; the edited drawing skips the check (M19.2). null = no hit.
   */
  pick(
    camera: THREE.Camera,
    x: number,
    y: number,
    width: number,
    height: number,
    visible: (point: Vec3) => boolean,
  ): Extract<PickResult, { kind: 'sketchEntity' }> | null;
  /**
   * The nearest region under the ray across all drawings (M13) whose hit is `visible`; regions of
   * the edited drawing count without the check (M19.2). null = no hit.
   */
  pickRegion(
    ray: { readonly origin: Vec3; readonly direction: Vec3 },
    visible: (point: Vec3) => boolean,
  ): Extract<PickResult, { kind: 'sketchRegion' }> | null;
  /**
   * Hover and selection of regions, from the highlight layer; replaces the whole state. The
   * selection wins over the hover. Targets of unknown drawings or regions are kept and drawn once
   * such a drawing is set. Requests a render.
   */
  setRegionHighlight(hover: RegionTarget | null, selection: readonly RegionTarget[]): void;
  /** Recolours every drawing (Q072); the caller requests the render. */
  setPalette(palette: ScenePalette): void;
  /** Canvas size in CSS px; fat-line materials need it to size their width in pixels. */
  setResolution(width: number, height: number): void;
  /**
   * The camera of the next frame (M19.2), called by the viewport before every frame: `worldPerPx`
   * mm per CSS px sizes the dashes of the hidden parts (6 px, gaps 4 px) and the grid step; the
   * grid of the edited drawing spans half of `viewportDiagonalPx` around the camera `target`
   * projected onto its plane. The grid is rebuilt only when it changes enough.
   */
  setPixelSize(worldPerPx: number, target: Vec3, viewportDiagonalPx: number): void;
  /**
   * Box around the curves and points of every drawing and the sketch grid (spec 09, "Near a far");
   * null = none.
   */
  bounds(): BoundingBox | null;
}

export interface SketchLayerOptions {
  readonly requestRender: () => void;
  readonly palette: ScenePalette;
}

/** One drawing: its tessellation (for picking and recolouring) and its Three.js objects. */
interface Entry {
  readonly drawing: SketchDrawing;
  readonly tessellation: SketchTessellation;
  readonly object: THREE.Group;
  readonly geometries: readonly THREE.BufferGeometry[];
  /** Fill of every region by its id; hidden unless highlighted. */
  readonly fills: ReadonlyMap<string, THREE.Mesh>;
  /** Box around the tessellated curves and points; the region fills lie inside the curves. */
  readonly bounds: BoundingBox | null;
}

/** The sketch grid as built (M19.2): what it was built for and its Three.js objects. */
interface Grid {
  readonly plane: Plane;
  readonly step: number;
  /** Centre of the square in the coordinates of the plane. */
  readonly center: Vec2;
  readonly halfExtent: number;
  readonly minor: THREE.LineSegments;
  readonly major: THREE.LineSegments;
  readonly bounds: BoundingBox | null;
}

/** The camera of the last setPixelSize. */
interface PixelSize {
  readonly worldPerPx: number;
  readonly target: Vec3;
  readonly viewportDiagonalPx: number;
}

export function createSketchLayer(options: SketchLayerOptions): SketchLayerInternal {
  const { requestRender } = options;
  let palette = options.palette;
  const group = new THREE.Group();
  // Colours come per vertex; the material colour stays white, so it does not tint them.
  const lineMaterial = new LineMaterial({
    color: 0xffffff,
    linewidth: LINE_WIDTH_PX,
    vertexColors: true,
    // Bodies hide the sketch (M19.2, D2); pulled forward, a line on a body face wins its depth.
    depthTest: true,
    depthWrite: false,
    ...PULL_FORWARD,
  });
  const pointMaterial = new THREE.PointsMaterial({
    color: 0xffffff,
    vertexColors: true,
    size: POINT_SIZE,
    sizeAttenuation: false,
    // Polygon offset does not apply to points; the push-back of the body faces is enough.
    depthTest: true,
    depthWrite: false,
  });
  // The second pass of the edited drawing: only where a body is in front (GreaterDepth), faint and
  // dashed. The same offset as the first pass, otherwise it would show over the visible part too.
  const hiddenLineMaterial = new LineMaterial({
    color: 0xffffff,
    linewidth: LINE_WIDTH_PX,
    vertexColors: true,
    depthTest: true,
    depthWrite: false,
    depthFunc: THREE.GreaterDepth,
    transparent: true,
    opacity: HIDDEN_OPACITY,
    dashed: true,
    ...PULL_FORWARD,
  });
  const hiddenPointMaterial = new THREE.PointsMaterial({
    color: 0xffffff,
    vertexColors: true,
    size: POINT_SIZE,
    sizeAttenuation: false,
    depthTest: true,
    depthWrite: false,
    depthFunc: THREE.GreaterDepth,
    transparent: true,
    opacity: HIDDEN_OPACITY,
  });
  const minorGridMaterial = createGridMaterial(palette.grid[1]);
  const majorGridMaterial = createGridMaterial(palette.grid[0]);
  const hoverFill = createFillMaterial(palette.hover);
  const selectionFill = createFillMaterial(palette.selection);
  const entries = new Map<string, Entry>();
  /** The drawings by id, for pickSketchRegion. */
  const drawings = new Map<string, SketchDrawing>();
  let regionHover: RegionTarget | null = null;
  let regionSelection: readonly RegionTarget[] = [];
  let grid: Grid | null = null;
  let pixelSize: PixelSize | null = null;
  const scratch = new THREE.Color();

  function colorOf(style: SketchStyle): number {
    switch (style) {
      case 'normal':
        return palette.sketch;
      case 'defined':
        return palette.sketchDefined;
      case 'construction':
      case 'plane':
        return palette.construction;
      case 'hover':
        return palette.hover;
      case 'selected':
        return palette.selection;
      default:
        return assertNever(style);
    }
  }

  /** rgb per style, repeated `perItem` times (2 ends of a segment, 1 point). */
  function colors(styles: readonly SketchStyle[], perItem: number): Float32Array {
    const result = new Float32Array(styles.length * perItem * 3);
    styles.forEach((style, i) => {
      scratch.setHex(colorOf(style));
      for (let k = 0; k < perItem; k++) {
        result.set([scratch.r, scratch.g, scratch.b], (i * perItem + k) * 3);
      }
    });
    return result;
  }

  function build(drawing: SketchDrawing, tessellation: SketchTessellation): Entry {
    const object = new THREE.Group();
    const geometries: THREE.BufferGeometry[] = [];
    const fills = new Map<string, THREE.Mesh>();
    const frame = frameMatrix(drawing.plane);
    for (const region of drawing.regions ?? []) {
      const geometry = new THREE.ShapeGeometry(regionShape(region));
      // World coordinates in the geometry: the layer sits at the identity transform.
      geometry.applyMatrix4(frame);
      geometries.push(geometry);
      const fill = new THREE.Mesh(geometry, hoverFill);
      fill.visible = false;
      fill.renderOrder = FILL_RENDER_ORDER;
      fills.set(region.id, fill);
      object.add(fill);
    }
    // Empty geometries are left out: fat lines compute bounds from their instances.
    if (tessellation.segmentCurves.length > 0) {
      const geometry = new LineSegmentsGeometry()
        .setPositions(tessellation.segments)
        .setColors(colors(tessellation.segmentStyles, 2));
      geometries.push(geometry);
      const lines = new LineSegments2(geometry, lineMaterial);
      lines.renderOrder = RENDER_ORDER;
      object.add(lines);
      if (drawing.editing === true) {
        const hidden = new LineSegments2(geometry, hiddenLineMaterial);
        // The dashes need the distances along the lines (attributes of the shared geometry).
        hidden.computeLineDistances();
        hidden.renderOrder = RENDER_ORDER;
        object.add(hidden);
      }
    }
    if (tessellation.pointIds.length > 0) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(tessellation.points, 3));
      geometry.setAttribute(
        'color',
        new THREE.BufferAttribute(colors(tessellation.pointStyles, 1), 3),
      );
      geometries.push(geometry);
      const points = new THREE.Points(geometry, pointMaterial);
      points.renderOrder = RENDER_ORDER;
      object.add(points);
      if (drawing.editing === true) {
        const hidden = new THREE.Points(geometry, hiddenPointMaterial);
        hidden.renderOrder = RENDER_ORDER;
        object.add(hidden);
      }
    }
    const bounds = unionBounds([
      meshBounds(tessellation.segments),
      meshBounds(tessellation.points),
    ]);
    return { drawing, tessellation, object, geometries, fills, bounds };
  }

  /** Shows the fill of every highlighted region of the entry in its colour, hides the others. */
  function paintFills(id: string, entry: Entry): void {
    for (const [region, fill] of entry.fills) {
      const is = (target: RegionTarget | null): boolean =>
        target !== null && target.sketch === id && target.region === region;
      if (regionSelection.some(is)) {
        fill.material = selectionFill;
        fill.visible = true;
      } else if (is(regionHover)) {
        fill.material = hoverFill;
        fill.visible = true;
      } else {
        fill.visible = false;
      }
    }
  }

  function show(id: string, entry: Entry): void {
    entries.set(id, entry);
    drawings.set(id, entry.drawing);
    paintFills(id, entry);
    group.add(entry.object);
  }

  /** Removes and disposes the drawing under id; false when there was none. */
  function drop(id: string): boolean {
    const entry = entries.get(id);
    if (entry === undefined) return false;
    entries.delete(id);
    drawings.delete(id);
    group.remove(entry.object);
    for (const geometry of entry.geometries) geometry.dispose();
    return true;
  }

  /** The plane of the edited drawing; null = no drawing is edited. */
  function editedPlane(): Plane | null {
    for (const entry of entries.values()) {
      if (entry.drawing.editing === true) return entry.drawing.plane;
    }
    return null;
  }

  function dropGrid(): void {
    if (grid === null) return;
    group.remove(grid.minor, grid.major);
    grid.minor.geometry.dispose();
    grid.major.geometry.dispose();
    grid = null;
  }

  /**
   * Builds, keeps or drops the grid for the edited drawing and the last pixel size. Rebuilt when
   * the plane or the step changes, the centre moves by more than a quarter of the half extent, or
   * the view outgrows the built square.
   */
  function updateGrid(): void {
    const plane = editedPlane();
    if (plane === null || pixelSize === null) {
      dropGrid();
      return;
    }
    const step = sketchGridStep(pixelSize.worldPerPx);
    const halfExtent = (pixelSize.worldPerPx * pixelSize.viewportDiagonalPx) / 2;
    const center = planeMath.toLocal(plane, pixelSize.target);
    if (
      grid !== null &&
      grid.plane === plane &&
      grid.step === step &&
      halfExtent <= grid.halfExtent &&
      Math.hypot(center[0] - grid.center[0], center[1] - grid.center[1]) <= grid.halfExtent / 4
    ) {
      return;
    }
    dropGrid();
    if (!(halfExtent > 0)) return;
    const lines = gridLines(step, center, halfExtent);
    const frame = frameMatrix(plane);
    const minor = gridObject(lines.minor, frame, minorGridMaterial);
    const major = gridObject(lines.major, frame, majorGridMaterial);
    group.add(minor, major);
    const bounds = unionBounds([
      meshBounds(positionsOf(minor.geometry)),
      meshBounds(positionsOf(major.geometry)),
    ]);
    grid = { plane, step, center, halfExtent, minor, major, bounds };
  }

  return {
    group,
    set(id: string, drawing: SketchDrawing): void {
      // Tessellate first: a throw leaves the previous drawing under id.
      const tessellation = tessellateSketch(drawing);
      drop(id);
      show(id, build(drawing, tessellation));
      updateGrid();
      requestRender();
    },
    remove(id: string): void {
      if (!drop(id)) return;
      updateGrid();
      requestRender();
    },
    pick(camera, x, y, width, height, visible) {
      if (entries.size === 0 || width <= 0 || height <= 0) return null;
      camera.updateMatrixWorld();
      // The layer and its drawings sit at the identity transform: world = model coordinates.
      const matrix = new THREE.Matrix4().multiplyMatrices(
        camera.projectionMatrix,
        camera.matrixWorldInverse,
      ).elements;
      let best: {
        readonly id: string;
        readonly entity: string;
        readonly point: Vec3;
        readonly hit: SketchHit;
      } | null = null;
      for (const [id, entry] of entries) {
        const { tessellation } = entry;
        const screenSegments = projectSegments(tessellation.segments, matrix, width, height);
        const screenPoints = toScreenPoints(
          projectSegments(asSegments(tessellation.points), matrix, width, height),
        );
        // The edited sketch is never hidden (M19.2, D2); the others take their first visible hit.
        const found = sketchHits(screenSegments, screenPoints, x, y)
          .map((hit) => resolveHit(tessellation, hit))
          .find(
            (resolved) =>
              resolved !== null && (entry.drawing.editing === true || visible(resolved.point)),
          );
        if (found === undefined || found === null) continue;
        // A point of any drawing wins over a curve of any drawing, then the nearer one.
        if (best === null || betterSketchHit(found.hit, best.hit)) best = { id, ...found };
      }
      if (best === null) return null;
      return { kind: 'sketchEntity', sketch: best.id, entity: best.entity, point: best.point };
    },
    pickRegion(ray, visible) {
      const hit = pickSketchRegion(
        drawings,
        ray,
        (sketch, point) => drawings.get(sketch)?.editing === true || visible(point),
      );
      return hit === null ? null : { kind: 'sketchRegion', ...hit };
    },
    setRegionHighlight(hover, selection): void {
      regionHover = hover;
      regionSelection = selection;
      for (const [id, entry] of entries) paintFills(id, entry);
      requestRender();
    },
    setPalette(next: ScenePalette): void {
      palette = next;
      hoverFill.color.setHex(next.hover);
      selectionFill.color.setHex(next.selection);
      minorGridMaterial.color.setHex(next.grid[1]);
      majorGridMaterial.color.setHex(next.grid[0]);
      // Rebuilt rather than recoloured in place: replacing the colour attribute of a fat line
      // would leave its old GPU buffer behind. Palette changes are rare.
      for (const [id, entry] of [...entries]) {
        drop(id);
        show(id, build(entry.drawing, entry.tessellation));
      }
    },
    setResolution(width: number, height: number): void {
      lineMaterial.resolution.set(width, height);
      hiddenLineMaterial.resolution.set(width, height);
    },
    setPixelSize(worldPerPx: number, target: Vec3, viewportDiagonalPx: number): void {
      // LineMaterial dashes are measured in model units along the line.
      hiddenLineMaterial.dashSize = DASH_PX * worldPerPx;
      hiddenLineMaterial.gapSize = GAP_PX * worldPerPx;
      pixelSize = { worldPerPx, target, viewportDiagonalPx };
      updateGrid();
    },
    bounds(): BoundingBox | null {
      return unionBounds([
        ...[...entries.values()].map((entry) => entry.bounds),
        grid?.bounds ?? null,
      ]);
    },
    dispose(): void {
      for (const id of [...entries.keys()]) drop(id);
      dropGrid();
      lineMaterial.dispose();
      pointMaterial.dispose();
      hiddenLineMaterial.dispose();
      hiddenPointMaterial.dispose();
      minorGridMaterial.dispose();
      majorGridMaterial.dispose();
      hoverFill.dispose();
      selectionFill.dispose();
    },
  };
}

function createFillMaterial(color: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: FILL_OPACITY,
    // Seen from either side of the sketch plane.
    side: THREE.DoubleSide,
    // Bodies hide it like the sketch lines (M19.2, D2), so a highlighted region no longer tints
    // a whole body; pulled forward like them. Transparent, so it writes no depth.
    depthTest: true,
    depthWrite: false,
    ...PULL_FORWARD,
  });
}

/** 1 px lines of the sketch grid: hidden by bodies, writing no depth (M19.2). */
function createGridMaterial(color: number): THREE.LineBasicMaterial {
  return new THREE.LineBasicMaterial({ color, depthTest: true, depthWrite: false });
}

/** Grid segments u0, v0, u1, v1 in the plane → world LineSegments placed by the plane frame. */
function gridObject(
  segments: readonly number[],
  frame: THREE.Matrix4,
  material: THREE.LineBasicMaterial,
): THREE.LineSegments {
  const positions = new Float32Array((segments.length / 2) * 3);
  for (let i = 0; i < segments.length / 2; i++) {
    positions[3 * i] = segments[2 * i] ?? 0;
    positions[3 * i + 1] = segments[2 * i + 1] ?? 0;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  // World coordinates in the geometry: the layer sits at the identity transform.
  geometry.applyMatrix4(frame);
  const lines = new THREE.LineSegments(geometry, material);
  lines.renderOrder = GRID_RENDER_ORDER;
  return lines;
}

/** World positions of a geometry built by gridObject. */
function positionsOf(geometry: THREE.BufferGeometry): Float32Array {
  const array = geometry.getAttribute('position').array;
  assert(array instanceof Float32Array, 'Grid positions must be a Float32Array');
  return array;
}

/** The entity id and the 3D point of a hit; null when the hit is out of the tessellation. */
function resolveHit(
  tessellation: SketchTessellation,
  hit: SketchHit,
): { readonly entity: string; readonly point: Vec3; readonly hit: SketchHit } | null {
  const entity =
    hit.kind === 'point' ? tessellation.pointIds[hit.index] : tessellation.segmentCurves[hit.index];
  if (entity === undefined) return null;
  const point: Vec3 =
    hit.kind === 'point'
      ? [
          tessellation.points[3 * hit.index] ?? 0,
          tessellation.points[3 * hit.index + 1] ?? 0,
          tessellation.points[3 * hit.index + 2] ?? 0,
        ]
      : // The screen parameter is also the 3D one: the orthographic projection is affine.
        segmentPoint(tessellation.segments, hit.index, hit.t);
  return { entity, point, hit };
}

/** The region in the 2D coordinates of its plane, holes as paths. */
function regionShape(region: SketchDrawingRegion): THREE.Shape {
  const shape = new THREE.Shape(region.outer.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const hole of region.holes) {
    shape.holes.push(new THREE.Path(hole.map(([x, y]) => new THREE.Vector2(x, y))));
  }
  return shape;
}

/** Plane coordinates (x, y, 0) → world: columns xDir, yDir, normal, translation origin. */
function frameMatrix(plane: Plane): THREE.Matrix4 {
  const yDir = planeMath.yDir(plane);
  return new THREE.Matrix4()
    .makeBasis(
      new THREE.Vector3(...plane.xDir),
      new THREE.Vector3(...yDir),
      new THREE.Vector3(...plane.normal),
    )
    .setPosition(...plane.origin);
}

/** Points (x, y, z each) as zero-length segments, so projectSegments projects and clips them. */
function asSegments(points: Float32Array): Float32Array {
  const result = new Float32Array(points.length * 2);
  for (let i = 0; i < points.length; i += 3) {
    result.set(points.subarray(i, i + 3), 2 * i);
    result.set(points.subarray(i, i + 3), 2 * i + 3);
  }
  return result;
}

/** x0, y0, x1, y1 of zero-length segments → x, y per point. */
function toScreenPoints(screenSegments: Float32Array): Float32Array {
  const result = new Float32Array(screenSegments.length / 2);
  for (let i = 0; i < screenSegments.length; i += 4) {
    result[i / 2] = screenSegments[i] ?? NaN;
    result[i / 2 + 1] = screenSegments[i + 1] ?? NaN;
  }
  return result;
}
