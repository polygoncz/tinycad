// Drawings of sketches and planes (spec 09, "Skici"): SketchDrawing → fat lines and points in an
// own group, drawn over the bodies, coloured per vertex by the style of the entity. A mirror like
// the overlay, but pickable: pick projects the tessellated drawings into px and asks pickSketch.

import * as THREE from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { assertNever, type Disposable, type Vec3 } from '@/core';
import type { PickResult, SketchDrawing, SketchPort, SketchStyle } from '@/interaction';
import type { ScenePalette } from './palette';
import { projectSegments, segmentPoint } from './pick-math';
import { tessellateSketch, type SketchTessellation } from './sketch-drawing';
import { betterSketchHit, pickSketch, type SketchHit } from './sketch-pick';

/** Width of sketch curves in CSS px. */
const LINE_WIDTH_PX = 2;
/** Size of sketch points in CSS px (no size attenuation, like a marker). */
const POINT_SIZE = 7;
/** After the bodies, the highlight and the overlay. */
const RENDER_ORDER = 3;

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
  readonly tessellation: SketchTessellation;
  readonly object: THREE.Group;
  readonly geometries: readonly THREE.BufferGeometry[];
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
  const entries = new Map<string, Entry>();
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

  function build(tessellation: SketchTessellation): Entry {
    const object = new THREE.Group();
    const geometries: THREE.BufferGeometry[] = [];
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
    return { tessellation, object, geometries };
  }

  function show(id: string, entry: Entry): void {
    entries.set(id, entry);
    group.add(entry.object);
  }

  /** Removes and disposes the drawing under id; false when there was none. */
  function drop(id: string): boolean {
    const entry = entries.get(id);
    if (entry === undefined) return false;
    entries.delete(id);
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
      show(id, build(tessellation));
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
    setPalette(next: ScenePalette): void {
      palette = next;
      // Rebuilt rather than recoloured in place: replacing the colour attribute of a fat line
      // would leave its old GPU buffer behind. Palette changes are rare.
      for (const [id, entry] of [...entries]) {
        drop(id);
        show(id, build(entry.tessellation));
      }
    },
    setResolution(width: number, height: number): void {
      lineMaterial.resolution.set(width, height);
    },
    dispose(): void {
      for (const id of [...entries.keys()]) drop(id);
      lineMaterial.dispose();
      pointMaterial.dispose();
    },
  };
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
