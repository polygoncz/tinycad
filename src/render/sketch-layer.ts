// Drawings of sketches and planes (spec 09, "Skici"): SketchDrawing → fat lines and points in an
// own group, drawn over the bodies, coloured per vertex by the style of the entity. A mirror like
// the overlay, but pickable: pick projects the tessellated drawings into px and asks pickSketch.
// Regions of a drawing (M13) get a transparent fill each, invisible until the highlight layer
// hands their hover or selection over; pickRegion intersects the ray with the drawing planes.

import * as THREE from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { assertNever, plane as planeMath, type Disposable, type Plane, type Vec3 } from '@/core';
import type {
  HighlightTarget,
  PickResult,
  SketchDrawing,
  SketchDrawingRegion,
  SketchPort,
  SketchStyle,
} from '@/interaction';
import type { ScenePalette } from './palette';
import { projectSegments, segmentPoint } from './pick-math';
import { tessellateSketch, type SketchTessellation } from './sketch-drawing';
import { betterSketchHit, pickSketch, pickSketchRegion, type SketchHit } from './sketch-pick';

/** Width of sketch curves in CSS px. */
const LINE_WIDTH_PX = 2;
/** Size of sketch points in CSS px (no size attenuation, like a marker). */
const POINT_SIZE = 7;
/** After the bodies, the highlight and the overlay. */
const RENDER_ORDER = 3;
/** Region fills: under the sketch lines (spec 09, "Skici"). */
const FILL_RENDER_ORDER = 2;
const FILL_OPACITY = 0.35;

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
   * drawings: points before curves, no occlusion by bodies. null = no hit.
   */
  pick(
    camera: THREE.Camera,
    x: number,
    y: number,
    width: number,
    height: number,
  ): Extract<PickResult, { kind: 'sketchEntity' }> | null;
  /** The nearest region under the ray across all drawings (M13); null = no hit. */
  pickRegion(ray: {
    readonly origin: Vec3;
    readonly direction: Vec3;
  }): Extract<PickResult, { kind: 'sketchRegion' }> | null;
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
    // Over the bodies: the plane of a sketch often lies on a body face (spec 09, R47).
    depthTest: false,
  });
  const pointMaterial = new THREE.PointsMaterial({
    color: 0xffffff,
    vertexColors: true,
    size: POINT_SIZE,
    sizeAttenuation: false,
    depthTest: false,
  });
  const hoverFill = createFillMaterial(palette.hover);
  const selectionFill = createFillMaterial(palette.selection);
  const entries = new Map<string, Entry>();
  /** The drawings by id, for pickSketchRegion. */
  const drawings = new Map<string, SketchDrawing>();
  let regionHover: RegionTarget | null = null;
  let regionSelection: readonly RegionTarget[] = [];
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
    }
    return { drawing, tessellation, object, geometries, fills };
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

  return {
    group,
    set(id: string, drawing: SketchDrawing): void {
      // Tessellate first: a throw leaves the previous drawing under id.
      const tessellation = tessellateSketch(drawing);
      drop(id);
      show(id, build(drawing, tessellation));
      requestRender();
    },
    remove(id: string): void {
      if (drop(id)) requestRender();
    },
    pick(camera, x, y, width, height) {
      if (entries.size === 0 || width <= 0 || height <= 0) return null;
      camera.updateMatrixWorld();
      // The layer and its drawings sit at the identity transform: world = model coordinates.
      const matrix = new THREE.Matrix4().multiplyMatrices(
        camera.projectionMatrix,
        camera.matrixWorldInverse,
      ).elements;
      let best: {
        readonly id: string;
        readonly entry: Entry;
        readonly hit: SketchHit;
      } | null = null;
      for (const [id, entry] of entries) {
        const { segments, points } = entry.tessellation;
        const screenSegments = projectSegments(segments, matrix, width, height);
        const screenPoints = toScreenPoints(
          projectSegments(asSegments(points), matrix, width, height),
        );
        const hit = pickSketch(screenSegments, screenPoints, x, y);
        if (hit === null) continue;
        // A point of any drawing wins over a curve of any drawing, then the nearer one.
        if (best === null || betterSketchHit(hit, best.hit)) best = { id, entry, hit };
      }
      if (best === null) return null;
      const { tessellation } = best.entry;
      const { hit } = best;
      const entity =
        hit.kind === 'point'
          ? tessellation.pointIds[hit.index]
          : tessellation.segmentCurves[hit.index];
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
      return { kind: 'sketchEntity', sketch: best.id, entity, point };
    },
    pickRegion(ray) {
      const hit = pickSketchRegion(drawings, ray);
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
      // Rebuilt rather than recoloured in place: replacing the colour attribute of a fat line
      // would leave its old GPU buffer behind. Palette changes are rare.
      for (const [id, entry] of [...entries]) {
        drop(id);
        show(id, build(entry.drawing, entry.tessellation));
      }
    },
    setResolution(width: number, height: number): void {
      lineMaterial.resolution.set(width, height);
    },
    dispose(): void {
      for (const id of [...entries.keys()]) drop(id);
      lineMaterial.dispose();
      pointMaterial.dispose();
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
    // Over the bodies like the sketch lines (R47); transparent, so it writes no depth.
    depthTest: false,
    depthWrite: false,
  });
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
