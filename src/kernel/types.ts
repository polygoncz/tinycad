import type { Brand, Vec3 } from '@/core';

// Values that cross the GeometryKernel port (spec 06): identity (handle) and plain data.

/**
 * Opaque id of a shape living inside the kernel. Positive integer, never reused within one
 * kernel instance, so a released handle always fails with 'unknown-handle'.
 */
export type ShapeHandle = Brand<number, 'ShapeHandle'>;

export interface BoundingBox {
  readonly min: Vec3;
  readonly max: Vec3;
}

export interface MeshQuality {
  readonly linearDeflection: number;
  readonly angularDeflection: number;
}

export interface ShapeResult {
  readonly shape: ShapeHandle;
  /** From M14, for operations with input shapes (spec 06, "Stav po M14"). */
  readonly history?: ShapeHistory;
  /** Named parts, e.g. { 'face:top': [5] }; keys without a feature id (ADR 0018). From M14. */
  readonly roles?: Readonly<Record<string, readonly SubShapeIndex[]>>;
}

/**
 * Index of a sub-shape = position in TopExp::MapShapes(shape, TopAbs_FACE/EDGE/VERTEX), from 0
 * (OCCT counts from 1, the adapter subtracts). Valid only for one handle.
 */
export interface SubShapeIndex {
  readonly type: 'face' | 'edge' | 'vertex';
  readonly index: number;
}

export interface ShapeHistory {
  /** For each input shape: sub-shape index in the input → sub-shape indices in the output. */
  readonly modified: readonly HistoryLink[];
  readonly generated: readonly HistoryLink[];
  readonly deleted: readonly { readonly input: number; readonly sub: SubShapeIndex }[];
}

export interface HistoryLink {
  readonly input: number;
  readonly from: SubShapeIndex;
  readonly to: readonly SubShapeIndex[];
}

/**
 * Flat typed arrays, so they can cross postMessage as transferables without copying. Each over
 * its own plain ArrayBuffer (not a SharedArrayBuffer, which cannot be transferred).
 */
export interface MeshData {
  /** xyz */
  readonly positions: Float32Array<ArrayBuffer>;
  /** xyz, unit length, one per vertex */
  readonly normals: Float32Array<ArrayBuffer>;
  /** Triangles, counter-clockwise when viewed from outside. */
  readonly indices: Uint32Array<ArrayBuffer>;
  /** Triangle ranges per B-rep face, for picking and face highlight: triples [faceIndex, firstTriangle, triangleCount]. */
  readonly faceRanges: Uint32Array<ArrayBuffer>;
  /** Edge polylines: points one after another. */
  readonly edgePositions: Float32Array<ArrayBuffer>;
  /** Triples [edgeIndex, firstPoint, pointCount]. */
  readonly edgeRanges: Uint32Array<ArrayBuffer>;
}

// Topology of a shape (spec 06, "Stav po M14"): what naming needs to know about faces and edges
// without the geometry itself. Indices are SubShapeIndex.index of the same handle.

export type SurfaceType = 'plane' | 'cylinder' | 'cone' | 'sphere' | 'torus' | 'other';

/** Plane of a planar face: a point on it and the unit normal pointing out of the solid (face orientation applied). */
export interface FacePlane {
  readonly origin: Vec3;
  readonly normal: Vec3;
}

export interface FaceInfo {
  readonly surface: SurfaceType;
  /** Present exactly when surface is 'plane'. */
  readonly plane?: FacePlane;
}

export interface EdgeInfo {
  /** Adjacent faces, ascending without duplicates (a seam of a lateral face: one). */
  readonly faces: readonly number[];
  /** End vertices, ascending without duplicates (closed edge: one, edge without a vertex: none). */
  readonly vertices: readonly number[];
  /** Point of the edge at half its parameter range; only to tell edges apart (#k, spec 08). */
  readonly midpoint: Vec3;
}

export interface TopologySummary {
  /** Index = SubShapeIndex of the face. */
  readonly faces: readonly FaceInfo[];
  /** Index = SubShapeIndex of the edge. */
  readonly edges: readonly EdgeInfo[];
  readonly vertexCount: number;
}
