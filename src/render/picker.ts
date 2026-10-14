// Picking (spec 09, "Picking"): what is under the cursor. Edges first, in screen space with a
// pixel tolerance and an occlusion check; then faces by a raycast against the body meshes.
// The filter (spec 10, "Port viewportu") turns either pass off; faces still hide edges.
//
// Cost: every pick projects all edge segments of all bodies and runs one raycast per edge
// candidate (plus one for the face). Fine for M8 (a box has 12 edges); large models will need a
// projection cached per camera change or GPU picking (spec 09, "Picking" point 4).

import * as THREE from 'three';
import { assert, type Vec3 } from '@/core';
import type { PickFilter, PickResult } from '@/interaction';
import type { BoundingBox } from '@/kernel';
import type { BodyView } from './body-view';
import { closestSegments } from './edge-pick';
import { triangleToFace } from './mesh-index';
import {
  occlusionTolerance,
  projectSegments,
  segmentPoint,
  toNdc,
  triangleNormal,
} from './pick-math';

/** Edge pick tolerance in CSS px (spec 09, "Picking" point 2). */
const EDGE_TOLERANCE_PX = 6;
/** Below this length (px) a projected segment counts as a point: an edge seen end-on. */
const POINT_SEGMENT_PX = 1e-3;
/** The filter of a pick without one (spec 10, "Port viewportu"). */
const DEFAULT_FILTER: PickFilter = Object.freeze(['edge', 'face']);

export interface PickerOptions {
  /** The shown bodies (BodyLayerInternal.views); the hidden ones are skipped. */
  readonly views: () => Iterable<BodyView>;
  /** Union of their bounds, for the occlusion tolerance. */
  readonly bounds: () => BoundingBox | null;
}

export interface Picker {
  /**
   * (x, y) in CSS px relative to a canvas of width × height CSS px. The filter says what can
   * be hit, default edges and faces; one without them (empty, or only sketch kinds) gives
   * null without looking at the scene.
   */
  pick(
    camera: THREE.Camera,
    x: number,
    y: number,
    width: number,
    height: number,
    filter?: PickFilter,
  ): PickResult | null;
}

/** One projected segment: its body and its index among the body's segments. */
interface SegmentRef {
  readonly view: BodyView;
  readonly positions: Float32Array;
  readonly segment: number;
}

export function createPicker(options: PickerOptions): Picker {
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const matrix = new THREE.Matrix4();

  /** Points the raycaster from the camera through (x, y) in NDC, over the full depth. */
  function aim(camera: THREE.Camera, x: number, y: number): void {
    raycaster.setFromCamera(ndc.set(x, y), camera);
    raycaster.near = 0;
    raycaster.far = Infinity;
  }

  function pickEdge(
    camera: THREE.Camera,
    views: readonly BodyView[],
    meshes: readonly THREE.Mesh[],
    x: number,
    y: number,
    size: { readonly width: number; readonly height: number },
  ): PickResult | null {
    const refs: SegmentRef[] = [];
    const parts: Float32Array[] = [];
    for (const view of views) {
      const positions = edgePositions(view);
      matrix
        .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
        .multiply(view.edges.matrixWorld);
      parts.push(projectSegments(positions, matrix.elements, size.width, size.height));
      for (let segment = 0; segment < positions.length / 6; segment++) {
        refs.push({ view, positions, segment });
      }
    }
    const screen = concat(parts);
    const tolerance = occlusionTolerance(options.bounds());

    for (const candidate of closestSegments(screen, x, y, EDGE_TOLERANCE_PX)) {
      const ref = refs[candidate.segment];
      if (ref === undefined) continue;
      // The screen parameter is also the 3D one: the orthographic projection is affine.
      const t = isPoint(screen, candidate.segment) ? nearerEnd(camera, ref) : candidate.t;
      const point = worldPoint(ref, t);
      if (!visible(camera, meshes, point, tolerance)) continue;
      return {
        kind: 'edge',
        body: ref.view.id,
        edgeIndex: edgeOfSegment(ref),
        point: [point.x, point.y, point.z],
      };
    }
    return null;
  }

  /**
   * True when the ray from the camera through `target` hits no face closer than `target` minus
   * the tolerance. The faces of the edge itself are hit at (almost) the depth of the point, also
   * when the ray goes exactly through the edge; the tolerance lets them pass.
   */
  function visible(
    camera: THREE.Camera,
    meshes: readonly THREE.Mesh[],
    target: THREE.Vector3,
    tolerance: number,
  ): boolean {
    const projected = target.clone().project(camera);
    aim(camera, projected.x, projected.y);
    const depth = target.clone().sub(raycaster.ray.origin).dot(raycaster.ray.direction);
    raycaster.far = Math.max(0, depth - tolerance);
    // A copy: three types the list as a mutable array.
    const blocked = raycaster.intersectObjects([...meshes], false).length > 0;
    raycaster.far = Infinity;
    return !blocked;
  }

  function pickFace(
    camera: THREE.Camera,
    views: readonly BodyView[],
    meshes: readonly THREE.Mesh[],
    x: number,
    y: number,
  ): PickResult | null {
    aim(camera, x, y);
    const hit = raycaster.intersectObjects([...meshes], false)[0];
    if (hit === undefined) return null;
    const view = views.find((v) => v.faces === hit.object);
    const triangle = hit.faceIndex;
    const face = hit.face;
    if (view === undefined || triangle === undefined || triangle === null || !face) return null;
    const faceIndex = triangleToFace(view.mesh.faceRanges, triangle);
    if (faceIndex === undefined) return null;

    const corner = (vertex: number): Vec3 =>
      toVec3(
        new THREE.Vector3()
          .fromArray(view.mesh.positions, 3 * vertex)
          .applyMatrix4(view.faces.matrixWorld),
      );
    return {
      kind: 'face',
      body: view.id,
      faceIndex,
      point: toVec3(hit.point),
      normal: triangleNormal(
        corner(face.a),
        corner(face.b),
        corner(face.c),
        toVec3(raycaster.ray.direction),
      ),
    };
  }

  return {
    pick(camera, x, y, width, height, filter = DEFAULT_FILTER) {
      // Only body kinds look at the scene; 'sketchEntity' (M12) or 'sketchRegion' (M13) alone
      // hits nothing here, the sketch drawings are picked by the viewport (spec 09, "Skici").
      const bodyKinds = filter.includes('edge') || filter.includes('face');
      if (!bodyKinds || width <= 0 || height <= 0) return null;
      // A hidden body (Q071) is neither picked nor hides what is behind it.
      const views = [...options.views()].filter((view) => view.object.visible);
      if (views.length === 0) return null;
      camera.updateMatrixWorld();
      for (const view of views) view.object.updateMatrixWorld();
      const meshes = views.map((view) => view.faces);

      // An edge within the tolerance wins over the face under the cursor (spec 09).
      if (filter.includes('edge')) {
        const edge = pickEdge(camera, views, meshes, x, y, { width, height });
        if (edge !== null) return edge;
      }
      if (!filter.includes('face')) return null;
      const at = toNdc(x, y, width, height);
      return pickFace(camera, views, meshes, at.x, at.y);
    },
  };
}

/** Segment positions of the body's LineSegments (pairs of points), as built by BodyView. */
function edgePositions(view: BodyView): Float32Array {
  const array = view.edges.geometry.getAttribute('position').array;
  assert(array instanceof Float32Array, 'Edge positions must be a Float32Array');
  return array;
}

/** Edge index of the referenced segment; BodyView builds segmentEdges for every segment. */
function edgeOfSegment(ref: SegmentRef): number {
  const edge = ref.view.segmentEdges[ref.segment];
  assert(edge !== undefined, `Segment ${String(ref.segment)} of body ${ref.view.id} has no edge`);
  return edge;
}

/** Point at parameter t of the referenced segment, in world space. */
function worldPoint(ref: SegmentRef, t: number): THREE.Vector3 {
  return new THREE.Vector3()
    .fromArray(segmentPoint(ref.positions, ref.segment, t))
    .applyMatrix4(ref.view.edges.matrixWorld);
}

/**
 * For an edge seen end-on (a point on screen), the end nearer the camera: the far end lies
 * behind the faces at the near one and would never count as visible.
 */
function nearerEnd(camera: THREE.Camera, ref: SegmentRef): number {
  // Camera space looks down −Z, so a larger z is nearer.
  const depth = (t: number): number => worldPoint(ref, t).applyMatrix4(camera.matrixWorldInverse).z;
  return depth(1) > depth(0) ? 1 : 0;
}

/** True when projected segment `segment` (x0, y0, x1, y1) is shorter than POINT_SEGMENT_PX. */
function isPoint(screen: Float32Array, segment: number): boolean {
  const i = 4 * segment;
  const dx = (screen[i + 2] ?? 0) - (screen[i] ?? 0);
  const dy = (screen[i + 3] ?? 0) - (screen[i + 1] ?? 0);
  return Math.hypot(dx, dy) < POINT_SEGMENT_PX;
}

function concat(parts: readonly Float32Array[]): Float32Array<ArrayBuffer> {
  const result = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function toVec3(v: THREE.Vector3): Vec3 {
  return [v.x, v.y, v.z];
}
